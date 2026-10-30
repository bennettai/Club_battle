"""Train and run a small CNN on Google's Quick, Draw! bitmap dataset.

The repository contains the dataset's category list, but not the drawing
archives themselves. Download the NumPy bitmap files with ``--download`` or
place them in ``quickdraw-dataset/numpy_bitmap``. Each file should be named
like ``airplane.npy`` and contain flattened 28x28 grayscale drawings.

Examples:
    python src/guess/guess.py train --classes apple cat dog --download
    python src/guess/guess.py train --num-classes 50 --download
    python src/guess/guess.py train --data-dir /data/quickdraw --epochs 10
    python src/guess/guess.py predict sketch.png --model doodle_cnn.pt
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path
from typing import Sequence

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset, random_split

try:
    from .data import (
        download_category,
        local_bitmap_path,
        random_available_categories,
        read_categories,
    )
except ImportError:  # Running this file directly as ``python src/guess/guess.py``.
    from data import (
        download_category,
        local_bitmap_path,
        random_available_categories,
        read_categories,
    )


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATEGORIES = PROJECT_ROOT / "quickdraw-dataset" / "categories.txt"
DEFAULT_DATA_DIR = PROJECT_ROOT / "quickdraw-dataset" / "numpy_bitmap"
DEFAULT_MODEL = PROJECT_ROOT / "doodle_cnn.pt"


class QuickDrawBitmaps(Dataset):
    """Memory-mapped bitmap examples selected from per-category ``.npy`` files."""

    def __init__(
        self,
        files: Sequence[tuple[str, Path]],
        max_per_class: int | None = 10_000,
        seed: int = 42,
    ) -> None:
        self.arrays: list[np.ndarray] = []
        self.labels: list[int] = []
        self.examples: list[tuple[int, int]] = []
        rng = np.random.default_rng(seed)

        for label, (category, path) in enumerate(files):
            array = np.load(path, mmap_mode="r")
            if array.ndim != 2 or array.shape[1] != 28 * 28:
                raise ValueError(
                    f"{path} has shape {array.shape}; expected N x 784 Quick, Draw! bitmaps"
                )
            if len(array) == 0:
                continue
            indexes = np.arange(len(array))
            if max_per_class is not None and len(indexes) > max_per_class:
                indexes = rng.choice(indexes, size=max_per_class, replace=False)
            array_index = len(self.arrays)
            self.arrays.append(array)
            self.labels.append(label)
            self.examples.extend((array_index, int(index)) for index in indexes)

        if not self.examples:
            raise ValueError("No drawings found in the selected bitmap files")

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        array_index, row_index = self.examples[index]
        pixels = np.asarray(self.arrays[array_index][row_index], dtype=np.float32).reshape(1, 28, 28)
        image = torch.from_numpy(pixels / 255.0)
        label = torch.tensor(self.labels[array_index], dtype=torch.long)
        return image, label


class DoodleCNN(nn.Module):
    """Compact convolutional classifier for 28x28 grayscale doodles."""

    def __init__(self, num_classes: int) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((3, 3)),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.25),
            nn.Linear(128 * 3 * 3, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.25),
            nn.Linear(256, num_classes),
        )

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(image))


def find_class_files(
    categories: Sequence[str], data_dir: Path, download: bool
) -> list[tuple[str, Path]]:
    files: list[tuple[str, Path]] = []
    missing: list[str] = []
    for category in categories:
        path = local_bitmap_path(category, data_dir)
        if path is None and download:
            path = download_category(category, data_dir)
        if path is not None and path.is_file():
            files.append((category, path))
        else:
            missing.append(category)
    if missing:
        names = ", ".join(missing[:8])
        suffix = " ..." if len(missing) > 8 else ""
        raise FileNotFoundError(
            f"Missing bitmap files for: {names}{suffix}. Put .npy files in {data_dir} "
            "or pass --download to fetch them. The repository has the category list, "
            "but does not include the bitmap archives."
        )
    if len(files) < 2:
        raise ValueError("Training needs at least two categories")
    return files


def train(args: argparse.Namespace) -> None:
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    random.seed(args.seed)

    all_categories = read_categories(args.categories_file)
    class_files: list[tuple[str, Path]]
    if args.classes:
        requested = args.classes
        unknown = [name for name in requested if name not in all_categories]
        if unknown:
            raise ValueError(f"Unknown Quick, Draw! categories: {', '.join(unknown)}")
        categories = list(dict.fromkeys(requested))
        class_files = find_class_files(categories, args.data_dir, args.download)
    elif args.num_classes is not None:
        class_files = random_available_categories(
            all_categories,
            args.num_classes,
            args.data_dir,
            download=args.download,
            seed=args.seed,
        )
        print("Selected categories: " + ", ".join(name for name, _ in class_files))
    else:
        categories = [
            name for name in all_categories
            if local_bitmap_path(name, args.data_dir) is not None
        ]
        if args.download:
            categories = all_categories
        if not categories:
            raise FileNotFoundError(
                f"No category .npy files found in {args.data_dir}. Download bitmap files "
                "or specify categories with --classes and use --download."
            )
        class_files = find_class_files(categories, args.data_dir, args.download)
    dataset = QuickDrawBitmaps(class_files, args.max_per_class, args.seed)
    if len(dataset) < 2:
        raise ValueError("Need at least two drawings to train")
    validation_size = max(1, int(len(dataset) * args.validation_fraction))
    training_size = len(dataset) - validation_size
    if training_size < 1:
        raise ValueError("Validation fraction leaves no training examples")
    training_set, validation_set = random_split(
        dataset,
        [training_size, validation_size],
        generator=torch.Generator().manual_seed(args.seed),
    )

    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    train_loader = DataLoader(
        training_set, batch_size=args.batch_size, shuffle=True, num_workers=args.workers
    )
    validation_loader = DataLoader(
        validation_set, batch_size=args.batch_size, shuffle=False, num_workers=args.workers
    )
    model = DoodleCNN(num_classes=len(class_files)).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    loss_function = nn.CrossEntropyLoss()
    best_accuracy = -1.0

    print(
        f"Training on {len(dataset):,} drawings across {len(class_files)} classes "
        f"using {device}"
    )
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_count = 0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(images)
            loss = loss_function(logits, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * labels.size(0)
            train_correct += (logits.argmax(1) == labels).sum().item()
            train_count += labels.size(0)

        model.eval()
        validation_correct = 0
        validation_count = 0
        with torch.no_grad():
            for images, labels in validation_loader:
                logits = model(images.to(device))
                validation_correct += (logits.argmax(1).cpu() == labels).sum().item()
                validation_count += labels.size(0)
        validation_accuracy = validation_correct / validation_count
        print(
            f"Epoch {epoch:02d}/{args.epochs}: "
            f"loss={train_loss / train_count:.4f}, "
            f"train_acc={train_correct / train_count:.3%}, "
            f"val_acc={validation_accuracy:.3%}"
        )

        if validation_accuracy > best_accuracy:
            best_accuracy = validation_accuracy
            args.model.parent.mkdir(parents=True, exist_ok=True)
            torch.save(
                {
                    "model_state": model.cpu().state_dict(),
                    "classes": [name for name, _ in class_files],
                    "input_size": 28,
                },
                args.model,
            )
            model.to(device)

    print(f"Saved best model ({best_accuracy:.3%} validation accuracy) to {args.model}")


def _prepare_image(image_path: Path) -> torch.Tensor:
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise RuntimeError("Pillow is required for image prediction: pip install pillow") from exc

    with Image.open(image_path) as source:
        image = ImageOps.grayscale(source)
    # Quick, Draw! bitmaps have bright strokes on a dark background. Invert
    # common white-background sketches to match that convention.
    if np.asarray(image, dtype=np.float32).mean() > 127:
        image = ImageOps.invert(image)
    image.thumbnail((24, 24), Image.Resampling.LANCZOS)
    canvas = Image.new("L", (28, 28), color=0)
    canvas.paste(image, ((28 - image.width) // 2, (28 - image.height) // 2))
    pixels = np.asarray(canvas, dtype=np.float32) / 255.0
    return torch.from_numpy(pixels[None, None, :, :])


def predict(args: argparse.Namespace) -> None:
    checkpoint = torch.load(args.model, map_location="cpu", weights_only=False)
    categories = checkpoint["classes"]
    model = DoodleCNN(len(categories))
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    image = _prepare_image(args.image)
    with torch.no_grad():
        probabilities = torch.softmax(model(image), dim=1)[0]
    count = min(args.top_k, len(categories))
    scores, indexes = torch.topk(probabilities, count)
    for score, index in zip(scores.tolist(), indexes.tolist()):
        print(f"{categories[index]}: {score:.1%}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train", help="train the doodle classifier")
    train_parser.add_argument("--categories-file", type=Path, default=DEFAULT_CATEGORIES)
    train_parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    class_selection = train_parser.add_mutually_exclusive_group()
    class_selection.add_argument("--classes", nargs="+", help="specific category labels to train on")
    class_selection.add_argument(
        "--num-classes",
        type=int,
        help="randomly select this many available categories, skipping missing files",
    )
    train_parser.add_argument("--download", action="store_true", help="download missing .npy files")
    train_parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    train_parser.add_argument("--epochs", type=int, default=30)
    train_parser.add_argument("--batch-size", type=int, default=128)
    train_parser.add_argument("--learning-rate", type=float, default=1e-3)
    train_parser.add_argument("--max-per-class", type=int, default=10_000)
    train_parser.add_argument("--validation-fraction", type=float, default=0.1)
    train_parser.add_argument("--workers", type=int, default=0)
    train_parser.add_argument("--seed", type=int, default=42)
    train_parser.add_argument("--device", help="for example cpu or cuda; defaults to available hardware")
    train_parser.set_defaults(run=train)

    predict_parser = subparsers.add_parser("predict", help="classify a doodle image")
    predict_parser.add_argument("image", type=Path)
    predict_parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    predict_parser.add_argument("--top-k", type=int, default=5)
    predict_parser.set_defaults(run=predict)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if getattr(args, "epochs", 1) < 1:
        parser.error("--epochs must be at least 1")
    if getattr(args, "max_per_class", 1) < 1:
        parser.error("--max-per-class must be at least 1")
    if getattr(args, "num_classes", None) is not None and args.num_classes < 2:
        parser.error("--num-classes must be at least 2")
    if getattr(args, "top_k", 1) < 1:
        parser.error("--top-k must be at least 1")
    if not 0 < getattr(args, "validation_fraction", 0.1) < 1:
        parser.error("--validation-fraction must be between 0 and 1")
    try:
        args.run(args)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
