#!/usr/bin/env python3
"""Derive a readable Codex Personal palette from a supplied background image."""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import warnings
from collections import Counter
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageOps, UnidentifiedImageError


SCHEMA = "codex-background-theme/v1"
ALGORITHM = "weighted-image-palette-readable-v2"
WHITE = (255, 255, 255)
INK_FALLBACK = (39, 43, 58)
ALLOWED_IMAGE_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})
MAX_IMAGE_PIXELS = 24_000_000
MAX_IMAGE_DIMENSION = 8_192

# Treat Pillow's warning threshold as a hard limit. This must be set before
# opening an untrusted image so a highly compressed image cannot allocate an
# unexpectedly large bitmap during palette extraction.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def clamp(value: float) -> int:
    return max(0, min(255, round(value)))


def mix(left: tuple[int, int, int], right: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(clamp(channel * (1 - amount) + target * amount) for channel, target in zip(left, right))


def shade(color: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return mix(color, (0, 0, 0), amount)


def lighten(color: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return mix(color, WHITE, amount)


def luminance(color: tuple[int, int, int]) -> float:
    channels = []
    for value in color:
        normalized = value / 255
        channels.append(normalized / 12.92 if normalized <= 0.04045 else ((normalized + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def hsv(color: tuple[int, int, int]) -> tuple[float, float, float]:
    return colorsys.rgb_to_hsv(*(channel / 255 for channel in color))


def hue_distance(left: float, right: float) -> float:
    delta = abs(left - right)
    return min(delta, 1 - delta)


def cap_luminance(color: tuple[int, int, int], maximum: float) -> tuple[int, int, int]:
    result = color
    for _ in range(18):
        if luminance(result) <= maximum:
            return result
        result = shade(result, 0.08)
    return result


def contrast_ratio(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    lighter = max(luminance(left), luminance(right))
    darker = min(luminance(left), luminance(right))
    return (lighter + 0.05) / (darker + 0.05)


def ensure_contrast(
    foreground: tuple[int, int, int],
    background: tuple[int, int, int],
    minimum: float,
) -> tuple[int, int, int]:
    """Darken a foreground token until it is readable on a light derived surface."""
    result = foreground
    for _ in range(24):
        if contrast_ratio(result, background) >= minimum:
            return result
        result = shade(result, 0.10)
    return result


def require_contrast(
    name: str,
    foreground: tuple[int, int, int],
    background: tuple[int, int, int],
    minimum: float,
) -> None:
    ratio = contrast_ratio(foreground, background)
    if ratio < minimum:
        raise ValueError(f"Derived {name} contrast is {ratio:.2f}:1; expected at least {minimum:.1f}:1.")


def hex_color(color: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{channel:02x}" for channel in color)


def rgba(color: tuple[int, int, int], opacity: float) -> str:
    alpha = f"{opacity:.2f}".rstrip("0").rstrip(".")
    return f"rgb({color[0]} {color[1]} {color[2]} / {alpha})"


def quantize(color: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(channel / 16) * 16)) for channel in color)


def inspect_image(source: Path) -> tuple[int, int, str]:
    """Verify format and dimensions before decoding any untrusted bitmap."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as probe:
                image_format = probe.format
                width, height = probe.size
                if image_format not in ALLOWED_IMAGE_FORMATS:
                    raise ValueError("Background must be a PNG, JPEG, or WebP image.")
                if width < 1 or height < 1 or width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                    raise ValueError(f"Background dimensions must be between 1 and {MAX_IMAGE_DIMENSION} pixels per side.")
                if width * height > MAX_IMAGE_PIXELS:
                    raise ValueError(f"Background may contain at most {MAX_IMAGE_PIXELS:,} pixels.")
                probe.verify()
                return width, height, image_format
    except (Image.DecompressionBombWarning, Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError(f"Unsafe, damaged, or unsupported background image: {error}") from error


def open_safe_image(source: Path) -> tuple[Image.Image, int, int, str]:
    """Open a previously verified image without retaining metadata."""
    width, height, image_format = inspect_image(source)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as original:
                if original.format != image_format:
                    raise ValueError("Background format changed while it was being processed.")
                image = ImageOps.exif_transpose(original)
                image.load()
                return image.copy(), width, height, image_format
    except (Image.DecompressionBombWarning, Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError(f"Unsafe, damaged, or unsupported background image: {error}") from error


def load_pixels(source: Path) -> tuple[list[tuple[int, int, int]], int, int]:
    image, width, height, _ = open_safe_image(source)
    image = image.convert("RGBA")
    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
    pixels = []
    for red, green, blue, alpha in image.getdata():
        coverage = alpha / 255
        pixels.append((
            clamp(red * coverage + 255 * (1 - coverage)),
            clamp(green * coverage + 255 * (1 - coverage)),
            clamp(blue * coverage + 255 * (1 - coverage)),
        ))
    return pixels, width, height


def sanitize_background(source: Path, destination: Path) -> dict[str, object]:
    """Re-encode a verified background as metadata-free PNG for local packaging."""
    image, width, height, image_format = open_safe_image(source)
    mode = "RGBA" if "A" in image.getbands() else "RGB"
    clean = Image.new(mode, image.size)
    clean.putdata(list(image.convert(mode).getdata()))
    destination.parent.mkdir(parents=True, exist_ok=True)
    clean.save(destination, format="PNG", optimize=True)
    return {
        "sourceFormat": image_format,
        "sanitizedFormat": "PNG",
        "width": width,
        "height": height,
        "bytes": destination.stat().st_size,
    }


def choose_color(
    entries: Iterable[tuple[int, tuple[int, int, int]]],
    predicate: Callable[[tuple[int, int, int]], bool],
    score: Callable[[int, tuple[int, int, int]], float],
    fallback: tuple[int, int, int],
) -> tuple[int, int, int]:
    candidates = [(score(count, color), count, color) for count, color in entries if predicate(color)]
    return max(candidates, default=(0, 0, fallback))[2]


def derive_palette(pixels: list[tuple[int, int, int]]) -> tuple[dict[str, tuple[int, int, int]], dict[str, str]]:
    buckets = Counter(quantize(pixel) for pixel in pixels)
    entries = [(count, color) for color, count in buckets.items()]

    def stats(color: tuple[int, int, int]) -> tuple[float, float, float, float]:
        hue, saturation, value = hsv(color)
        return hue, saturation, value, luminance(color)

    dark = choose_color(
        entries,
        lambda color: stats(color)[3] < 0.42,
        lambda count, color: count * (1.16 - stats(color)[3]) * (0.84 + stats(color)[1] * 0.16),
        INK_FALLBACK,
    )
    light = choose_color(
        entries,
        lambda color: stats(color)[3] > 0.48,
        lambda count, color: count * (0.26 + stats(color)[3]) ** 2 * (0.88 + stats(color)[1] * 0.12),
        (245, 233, 228),
    )
    blush_fallback = mix(light, (218, 96, 134), 0.54)
    blush = choose_color(
        entries,
        lambda color: (stats(color)[0] >= 0.86 or stats(color)[0] <= 0.03) and hue_distance(stats(color)[0], 0.98) <= 0.12 and stats(color)[1] >= 0.32 and 0.18 <= stats(color)[3] <= 0.94,
        lambda count, color: count * (stats(color)[1] ** 1.35) * (0.30 + stats(color)[3]) * (1 + (1 - hue_distance(stats(color)[0], 0.98) / 0.12)),
        blush_fallback,
    )
    gold_fallback = mix(light, (213, 157, 71), 0.52)
    gold = choose_color(
        entries,
        lambda color: 0.06 <= stats(color)[0] <= 0.19 and stats(color)[1] >= 0.35 and 0.28 <= stats(color)[3] <= 0.94,
        lambda count, color: count * (stats(color)[1] ** 1.2) * (0.28 + stats(color)[3]),
        gold_fallback,
    )
    cool_fallback = mix(dark, (101, 142, 181), 0.66)
    cool = choose_color(
        entries,
        lambda color: 0.50 <= stats(color)[0] <= 0.72 and stats(color)[1] >= 0.12 and stats(color)[3] >= 0.16,
        lambda count, color: count * (0.14 + stats(color)[1]) * (0.26 + stats(color)[3]),
        cool_fallback,
    )

    ink = cap_luminance(mix(dark, INK_FALLBACK, 0.48), 0.16)
    canvas = lighten(light, 0.48)
    chrome = mix(canvas, lighten(blush, 0.70), 0.40)
    sidebar = mix(canvas, lighten(blush, 0.54), 0.56)
    surface = lighten(light, 0.62)
    reading_surface = lighten(light, 0.72)
    sidebar_surface = lighten(sidebar, 0.18)
    panel_surface = lighten(surface, 0.20)
    conversation_header = mix(chrome, reading_surface, 0.38)
    disabled_surface = mix(chrome, reading_surface, 0.62)
    terminal_surface = cap_luminance(mix(dark, INK_FALLBACK, 0.48), 0.09)
    terminal_foreground = lighten(canvas, 0.72)
    primary = cap_luminance(shade(blush, 0.26), 0.22)
    primary_hover = cap_luminance(shade(blush, 0.39), 0.16)
    secondary = lighten(gold, 0.48)
    link = ensure_contrast(cap_luminance(mix(cool, ink, 0.34), 0.24), reading_surface, 4.5)
    project = ensure_contrast(cap_luminance(shade(gold, 0.30), 0.30), sidebar, 3.0)
    muted = ensure_contrast(mix(ink, canvas, 0.48), reading_surface, 4.5)
    disabled_text = ensure_contrast(mix(ink, canvas, 0.46), disabled_surface, 4.5)
    line = mix(blush, canvas, 0.60)
    line_strong = mix(primary, canvas, 0.52)
    hover = mix(lighten(blush, 0.60), canvas, 0.28)
    active = mix(lighten(blush, 0.48), reading_surface, 0.18)
    sidebar_rest = ensure_contrast(link, sidebar, 3.0)
    sidebar_thread = ensure_contrast(primary, sidebar, 3.0)
    sidebar_file = ensure_contrast(link, sidebar, 3.0)
    sidebar_hover = ensure_contrast(cap_luminance(shade(blush, 0.12), 0.28), sidebar, 3.0)
    sidebar_active = ensure_contrast(primary_hover, active, 3.0)
    sidebar_muted = ensure_contrast(muted, sidebar, 3.0)
    on_active_surface = ensure_contrast(ink, active, 4.5)

    require_contrast("secondary text", muted, reading_surface, 4.5)
    require_contrast("disabled control text", disabled_text, disabled_surface, 4.5)
    require_contrast("primary button label", WHITE, primary, 4.5)
    require_contrast("active surface text", on_active_surface, active, 4.5)
    require_contrast("sidebar project icon", project, sidebar, 3.0)
    require_contrast("sidebar muted icon", sidebar_muted, sidebar, 3.0)
    require_contrast("terminal text", terminal_foreground, terminal_surface, 4.5)

    swatches = {
        "ink": ink,
        "blush": blush,
        "gold": gold,
        "cool": cool,
        "light": light,
    }
    tokens = {
        "--personal-canvas": hex_color(canvas),
        "--personal-chrome": hex_color(chrome),
        "--personal-sidebar": hex_color(sidebar),
        "--personal-surface": rgba(surface, 0.70),
        "--personal-surface-strong": hex_color(reading_surface),
        "--personal-lilac": hex_color(lighten(blush, 0.70)),
        "--personal-mint": hex_color(lighten(gold, 0.66)),
        "--personal-teal": hex_color(primary),
        "--personal-teal-hover": hex_color(primary_hover),
        "--personal-blue": hex_color(link),
        "--personal-purple": hex_color(primary),
        "--personal-pink": hex_color(primary),
        "--personal-file": hex_color(link),
        "--personal-text": hex_color(ink),
        "--personal-muted": hex_color(muted),
        "--personal-line": hex_color(line),
        "--personal-line-strong": hex_color(line_strong),
        "--personal-image-scrim": rgba(sidebar_surface, 0.92),
        "--personal-image-scrim-middle": rgba(WHITE, 0.04),
        "--personal-image-scrim-end": rgba(panel_surface, 0.92),
        "--personal-image-top-scrim": rgba(conversation_header, 0.42),
        "--personal-image-bottom-scrim": rgba(chrome, 0.64),
        "--personal-image-opacity": "0.56",
        "--personal-image-saturation": "1.08",
        "--personal-image-contrast": "1.06",
        "--personal-image-brightness": "0.86",
        "--personal-workbench-blush": rgba(blush, 0.34),
        "--personal-workbench-gold": rgba(gold, 0.30),
        "--personal-workbench-end": hex_color(chrome),
        "--personal-sidebar-surface": hex_color(sidebar_surface),
        "--personal-main-surface": rgba(canvas, 0.16),
        "--personal-panel-surface": hex_color(panel_surface),
        "--personal-conversation-surface": hex_color(reading_surface),
        "--personal-conversation-header": hex_color(conversation_header),
        "--personal-reading-surface": hex_color(reading_surface),
        "--personal-input-surface": hex_color(reading_surface),
        "--personal-secondary-surface": hex_color(secondary),
        "--personal-hover-surface": hex_color(hover),
        "--personal-active-surface": hex_color(active),
        "--personal-disabled-surface": hex_color(disabled_surface),
        "--personal-disabled-text": hex_color(disabled_text),
        "--personal-on-active-surface": hex_color(on_active_surface),
        "--personal-on-accent": "#ffffff",
        "--personal-focus-ring": hex_color(primary),
        "--personal-focus-glow": rgba(blush, 0.20),
        "--personal-dialog-surface": hex_color(reading_surface),
        "--personal-shadow": rgba(ink, 0.13),
        "--personal-elevation-shadow": rgba(ink, 0.17),
        "--personal-code-surface": hex_color(reading_surface),
        "--personal-terminal-surface": hex_color(terminal_surface),
        "--personal-terminal-foreground": hex_color(terminal_foreground),
        "--personal-scrollbar": rgba(primary, 0.44),
        "--personal-scrollbar-hover": rgba(blush, 0.56),
        "--personal-selection": rgba(blush, 0.34),
        "--personal-added": "#3b8f70",
        "--personal-removed": hex_color(primary),
        "--personal-sidebar-icon-rest": hex_color(sidebar_rest),
        "--personal-sidebar-icon-project": hex_color(project),
        "--personal-sidebar-icon-thread": hex_color(sidebar_thread),
        "--personal-sidebar-icon-file": hex_color(sidebar_file),
        "--personal-sidebar-icon-hover": hex_color(sidebar_hover),
        "--personal-sidebar-icon-active": hex_color(sidebar_active),
        "--personal-sidebar-icon-muted": hex_color(sidebar_muted),
    }
    return swatches, tokens


def derive(source: Path) -> dict[str, object]:
    pixels, width, height = load_pixels(source)
    if not pixels:
        raise ValueError("The background image contains no sampleable pixels.")
    swatches, tokens = derive_palette(pixels)
    signature_source = json.dumps(tokens, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return {
        "schema": SCHEMA,
        "algorithm": ALGORITHM,
        "derived": True,
        "signature": hashlib.sha256(signature_source).hexdigest()[:16],
        "width": width,
        "height": height,
        "sampleCount": len(pixels),
        "swatches": {name: hex_color(color) for name, color in swatches.items()},
        "tokens": tokens,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("background", type=Path)
    parser.add_argument("--json", action="store_true", help="emit JSON (the default output format)")
    parser.add_argument("--sanitize-output", type=Path, help="write a metadata-free PNG copy to this path")
    args = parser.parse_args()
    result = derive(args.background.resolve())
    if args.sanitize_output:
        result["sanitized"] = sanitize_background(args.background.resolve(), args.sanitize_output.resolve())
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
