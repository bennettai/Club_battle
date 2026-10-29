"""Download Quick, Draw! NumPy bitmap files by category.

Examples:
    python src/guess/data.py --num-classes 50 --seed 42
    python src/guess/data.py --classes cat dog apple
    python src/guess/data.py  # download all categories in categories.txt

Each downloaded file contains all bitmap drawings for that category. The
training script can limit how many of those drawings it loads per class.
"""

from __future__ import annotations

import argparse
import random
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATEGORIES = PROJECT_ROOT / "quickdraw-dataset" / "categories.txt"
DEFAULT_DATA_DIR = PROJECT_ROOT / "quickdraw-dataset" / "numpy_bitmap"
QUICKDRAW_BITMAPS_URL = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap"


def read_categories(path: Path = DEFAULT_CATEGORIES) -> list[str]:
    if not path.is_file():
        raise FileNotFoundError(f"Category list not found: {path}")
    with path.open(encoding="utf-8") as file:
        return [line.strip() for line in file if line.strip()]


def category_filename(category: str) -> str:
    """Convert a category label to the usual Quick, Draw! file name."""
    return re.sub(r"[^A-Za-z0-9]+", "_", category.strip()).strip("_") + ".npy"


def local_bitmap_path(category: str, data_dir: Path = DEFAULT_DATA_DIR) -> Path | None:
    expected = category_filename(category)
    candidates = dict.fromkeys((expected, expected.lower(), expected.title()))
    return next(
        (data_dir / filename for filename in candidates if (data_dir / filename).is_file()),
        None,
    )


def download_category(category: str, data_dir: Path = DEFAULT_DATA_DIR) -> Path:
    """Download one category's complete public bitmap file."""
    existing = local_bitmap_path(category, data_dir)
    if existing is not None:
        return existing

    data_dir.mkdir(parents=True, exist_ok=True)
    destination = data_dir / category_filename(category)
    stem = destination.stem
    variants = list(dict.fromkeys((stem, stem.lower(), stem.title())))
    errors: list[str] = []
    for variant in variants:
        url = f"{QUICKDRAW_BITMAPS_URL}/{variant}.npy"
        temporary_path = destination.with_name(destination.name + ".part")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "skribl-ai/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                with temporary_path.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
            temporary_path.replace(destination)
            return destination
        except urllib.error.HTTPError as exc:
            temporary_path.unlink(missing_ok=True)
            errors.append(f"{variant}: {exc}")
            if exc.code != 404:
                raise RuntimeError(f"Download failed for {url}: {exc}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            temporary_path.unlink(missing_ok=True)
            raise RuntimeError(f"Download failed for {url}: {exc}") from exc
    raise FileNotFoundError(
        f"Could not download category {category!r} from the Quick, Draw! archive. "
        + "; ".join(errors)
    )


def download_categories(
    categories: Sequence[str],
    data_dir: Path = DEFAULT_DATA_DIR,
    *,
    skip_missing: bool = False,
) -> list[tuple[str, Path]]:
    """Download categories, optionally skipping those absent from the archive."""
    available: list[tuple[str, Path]] = []
    missing: list[str] = []
    for category in categories:
        try:
            path = download_category(category, data_dir)
            available.append((category, path))
            print(f"Downloaded/available: {category} -> {path}", flush=True)
        except FileNotFoundError:
            missing.append(category)
            print(f"Not in archive, skipping: {category}", flush=True)

    if missing and not skip_missing:
        raise FileNotFoundError("No bitmap files for: " + ", ".join(missing))
    return available


def random_available_categories(
    categories: Sequence[str],
    count: int,
    data_dir: Path = DEFAULT_DATA_DIR,
    *,
    download: bool = False,
    seed: int = 42,
) -> list[tuple[str, Path]]:
    """Choose up to ``count`` random categories that have bitmap files."""
    if count < 1:
        raise ValueError("count must be at least 1")
    shuffled = list(categories)
    random.Random(seed).shuffle(shuffled)
    available: list[tuple[str, Path]] = []
    for category in shuffled:
        path = local_bitmap_path(category, data_dir)
        if path is None and download:
            try:
                path = download_category(category, data_dir)
            except FileNotFoundError:
                print(f"Not in archive, skipping: {category}", flush=True)
                continue
            print(f"Downloaded: {category} -> {path}", flush=True)
        if path is not None:
            available.append((category, path))
            if len(available) == count:
                break
    if len(available) < count:
        raise FileNotFoundError(
            f"Found only {len(available)} available categories; requested {count}."
        )
    return available


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--categories-file", type=Path, default=DEFAULT_CATEGORIES)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--classes", nargs="+", help="download these category labels")
    selection.add_argument(
        "--num-classes", type=int, help="download this many random available categories"
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.num_classes is not None and args.num_classes < 1:
        parser.error("--num-classes must be at least 1")

    categories = read_categories(args.categories_file)
    if args.classes:
        unknown = [name for name in args.classes if name not in categories]
        if unknown:
            parser.error("Unknown categories: " + ", ".join(unknown))
        downloaded = download_categories(args.classes, args.data_dir, skip_missing=True)
    elif args.num_classes is not None:
        downloaded = random_available_categories(
            categories,
            args.num_classes,
            args.data_dir,
            download=True,
            seed=args.seed,
        )
    else:
        downloaded = download_categories(categories, args.data_dir, skip_missing=True)

    print(f"Available bitmap files: {len(downloaded)} in {args.data_dir}")


if __name__ == "__main__":
    main()
