#!/usr/bin/env python3
"""Generate all Captivela Office platform icon assets from the approved 1024 master."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "packages/ui/src/brand/assets/captivela-platform-icon-c-transparent-1024.png"
BUILD = ROOT / "apps/shell/build"
APP_ICON_TARGETS = [
    ROOT / "apps/shell/src/renderer/src/assets/app-icon.png",
    ROOT / "apps/docs/src/renderer/assets/app-icon.png",
    ROOT / "apps/sheets/src/renderer/assets/app-icon.png",
    ROOT / "apps/slides/src/renderer/assets/app-icon.png",
]
APPROVED_SHA256 = "7bd4fe119015160a31a87c390a96cf6486d9f57764fbe7ec437375031df98bde"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_png(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resized = image if image.size == (size, size) else image.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(path, format="PNG", optimize=True)


def main() -> None:
    if sha256(MASTER) != APPROVED_SHA256:
        raise SystemExit("Approved Captivela icon master hash mismatch")

    image = Image.open(MASTER).convert("RGBA")
    if image.size != (1024, 1024):
        raise SystemExit(f"Expected 1024x1024 master, got {image.size}")

    BUILD.mkdir(parents=True, exist_ok=True)
    save_png(image, BUILD / "icon.png", 1024)
    save_png(image, BUILD / "icon-mac.png", 1024)
    for target in APP_ICON_TARGETS:
        save_png(image, target, 1024)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    image.save(BUILD / "icon.ico", format="ICO", sizes=ico_sizes)

    with tempfile.TemporaryDirectory(prefix="captivela-icon-") as tmp:
        iconset = Path(tmp) / "CaptivelaOffice.iconset"
        iconset.mkdir()
        for points, scale in ((16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)):
            pixels = points * scale
            suffix = "@2x" if scale == 2 else ""
            save_png(image, iconset / f"icon_{points}x{points}{suffix}.png", pixels)
        subprocess.run(
            ["iconutil", "--convert", "icns", "--output", str(BUILD / "icon.icns"), str(iconset)],
            check=True,
        )

    print(f"Generated Captivela platform icons from {MASTER.relative_to(ROOT)}")
    for path in [BUILD / "icon.png", BUILD / "icon-mac.png", BUILD / "icon.icns", BUILD / "icon.ico", *APP_ICON_TARGETS]:
        print(f"{path.relative_to(ROOT)} {path.stat().st_size} bytes sha256={sha256(path)}")


if __name__ == "__main__":
    main()
