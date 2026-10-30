"""A 512x512 doodle pad that prints model predictions every 1.5 seconds."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import tkinter as tk

from PIL import Image, ImageDraw

from res import DEFAULT_MODEL, DoodlePredictor


CANVAS_SIZE = 512
PREDICTION_INTERVAL_MS = 1500
INK_WIDTH = 8


class DoodleCanvas:
    def __init__(self, root: tk.Tk, model_path: Path) -> None:
        self.root = root
        self.root.title("Quick, Draw! Doodle Classifier")
        self.root.resizable(False, False)
        self.last_point: tuple[int, int] | None = None
        self.has_drawing = False
        self.image = Image.new("L", (CANVAS_SIZE, CANVAS_SIZE), color="white")
        self.image_draw = ImageDraw.Draw(self.image)

        try:
            self.predictor: DoodlePredictor | None = DoodlePredictor(model_path)
            self.model_error: str | None = None
        except (FileNotFoundError, KeyError, RuntimeError, ValueError) as exc:
            self.predictor = None
            self.model_error = str(exc)
            print(f"Prediction unavailable: {self.model_error}", flush=True)

        toolbar = tk.Frame(root, padx=8, pady=8)
        toolbar.pack(fill="x")
        tk.Label(toolbar, text="Draw with the left mouse button").pack(side="left")
        tk.Button(toolbar, text="Clear", command=self.clear).pack(side="right")

        self.surface = tk.Canvas(
            root,
            width=CANVAS_SIZE,
            height=CANVAS_SIZE,
            background="white",
            highlightthickness=1,
            highlightbackground="#888888",
            cursor="crosshair",
        )
        self.surface.pack(padx=8, pady=(0, 8))
        self.surface.bind("<Button-1>", self.start_stroke)
        self.surface.bind("<B1-Motion>", self.continue_stroke)
        self.surface.bind("<ButtonRelease-1>", self.end_stroke)

        self.status = tk.StringVar(value="Predictions will appear in the terminal every 1.5 seconds.")
        tk.Label(root, textvariable=self.status, anchor="w", padx=8, pady=6).pack(fill="x")
        self.root.after(PREDICTION_INTERVAL_MS, self.report_prediction)

    def start_stroke(self, event: tk.Event) -> None:
        point = (event.x, event.y)
        self.last_point = point
        self.has_drawing = True
        radius = INK_WIDTH // 2
        self.surface.create_oval(
            point[0] - radius,
            point[1] - radius,
            point[0] + radius,
            point[1] + radius,
            fill="black",
            outline="black",
        )
        self.image_draw.ellipse(
            (point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius),
            fill="black",
        )

    def continue_stroke(self, event: tk.Event) -> None:
        if self.last_point is None:
            self.start_stroke(event)
            return
        point = (event.x, event.y)
        self.surface.create_line(
            *self.last_point,
            *point,
            fill="black",
            width=INK_WIDTH,
            capstyle=tk.ROUND,
            smooth=True,
        )
        self.image_draw.line(
            (*self.last_point, *point),
            fill="black",
            width=INK_WIDTH,
        )
        radius = INK_WIDTH // 2
        self.image_draw.ellipse(
            (point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius),
            fill="black",
        )
        self.last_point = point
        self.has_drawing = True

    def end_stroke(self, _event: tk.Event) -> None:
        self.last_point = None

    def clear(self) -> None:
        self.surface.delete("all")
        self.image = Image.new("L", (CANVAS_SIZE, CANVAS_SIZE), color="white")
        self.image_draw = ImageDraw.Draw(self.image)
        self.last_point = None
        self.has_drawing = False

    def report_prediction(self) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        if self.predictor is None:
            message = f"{timestamp} | prediction unavailable: {self.model_error}"
        elif not self.has_drawing:
            message = f"{timestamp} | canvas is blank; draw something to classify"
        else:
            predictions = self.predictor.predict(self.image)
            formatted = ", ".join(f"{label} {score:.1%}" for label, score in predictions)
            message = f"{timestamp} | {formatted}"
        print(message, flush=True)
        self.status.set(message.split(" | ", maxsplit=1)[1])
        self.root.after(PREDICTION_INTERVAL_MS, self.report_prediction)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()
    root = tk.Tk()
    DoodleCanvas(root, args.model)
    root.mainloop()


if __name__ == "__main__":
    main()
