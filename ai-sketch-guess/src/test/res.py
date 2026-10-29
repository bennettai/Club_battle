"""Quick, Draw! model inference helpers for the drawing canvas."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps


SRC_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SRC_DIR.parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from guess.guess import DoodleCNN  # noqa: E402


DEFAULT_MODEL = PROJECT_ROOT / "doodle_cnn.pt"


def prepare_canvas_image(image: Image.Image) -> torch.Tensor:
    """Convert the white canvas with dark ink to Quick, Draw!'s 28x28 format."""
    grayscale = ImageOps.grayscale(image)
    # Quick, Draw! bitmaps use white strokes on black. The UI uses black ink on
    # white, so invert it, crop empty space, and center the drawing like MNIST.
    inverted = ImageOps.invert(grayscale)
    bounds = inverted.getbbox()
    canvas = Image.new("L", (28, 28), color=0)
    if bounds:
        drawing = inverted.crop(bounds)
        drawing.thumbnail((24, 24), Image.Resampling.LANCZOS)
        canvas.paste(drawing, ((28 - drawing.width) // 2, (28 - drawing.height) // 2))
    pixels = np.asarray(canvas, dtype=np.float32) / 255.0
    return torch.from_numpy(pixels[None, None, :, :])


class DoodlePredictor:
    """Load a trained classifier once and score canvas snapshots on demand."""

    def __init__(self, model_path: Path = DEFAULT_MODEL, top_k: int = 5) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"Model checkpoint not found: {model_path}. Train one with "
                "python src/guess/guess.py train --classes apple cat dog --download"
            )
        checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
        self.classes: list[str] = checkpoint["classes"]
        self.top_k = max(1, min(top_k, len(self.classes)))
        self.model = DoodleCNN(num_classes=len(self.classes))
        self.model.load_state_dict(checkpoint["model_state"])
        self.model.eval()

    @torch.inference_mode()
    def predict(self, image: Image.Image) -> list[tuple[str, float]]:
        probabilities = torch.softmax(self.model(prepare_canvas_image(image)), dim=1)[0]
        scores, indexes = torch.topk(probabilities, self.top_k)
        return [
            (self.classes[index], float(score))
            for score, index in zip(scores.tolist(), indexes.tolist())
        ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify a saved doodle image")
    parser.add_argument("image", type=Path)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args()
    if args.top_k < 1:
        parser.error("--top-k must be at least 1")
    predictor = DoodlePredictor(args.model, args.top_k)
    with Image.open(args.image) as image:
        predictions = predictor.predict(image)
    for label, score in predictions:
        print(f"{label}: {score:.1%}")


if __name__ == "__main__":
    main()
