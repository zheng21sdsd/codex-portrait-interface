#!/usr/bin/env python3
"""Focused regression tests for image validation and metadata removal."""

from __future__ import annotations

import importlib.util
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "skills" / "codex-portrait-interface" / "scripts" / "derive-background-theme.py"
SPEC = importlib.util.spec_from_file_location("derive_background_theme", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def png_chunk(name: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)


class ImageSafetyTests(unittest.TestCase):
    def test_rejects_real_gif_with_jpeg_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "misleading.jpg"
            Image.new("RGB", (8, 8), "red").save(source, format="GIF")
            with self.assertRaises(ValueError):
                MODULE.inspect_image(source)

    def test_rejects_oversized_png_header_without_decoding_bitmap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "oversized.png"
            ihdr = struct.pack(">IIBBBBB", 10_000, 10_000, 8, 2, 0, 0, 0)
            source.write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IEND", b""))
            with self.assertRaises(ValueError):
                MODULE.inspect_image(source)

    def test_sanitizer_writes_png_without_exif(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.webp"
            output = Path(directory) / "sanitized.png"
            Image.new("RGBA", (16, 16), (20, 30, 40, 180)).save(source, format="WEBP")
            metadata = MODULE.sanitize_background(source, output)
            self.assertEqual(metadata["sanitizedFormat"], "PNG")
            with Image.open(output) as image:
                self.assertEqual(image.format, "PNG")
                self.assertFalse(image.getexif())


if __name__ == "__main__":
    unittest.main()
