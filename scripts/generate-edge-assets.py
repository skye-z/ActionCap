#!/usr/bin/env python3
"""
Generate Microsoft Edge Add-ons visual assets.

This helper requires Pillow in the system Python environment.
It is not part of the npm build and is only used when refreshing store assets.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ICONS_DIR = ROOT / "public" / "icons"
STORE_ASSETS_DIR = ROOT / "store-assets" / "edge"

BG_TOP = "#081019"
BG_BOTTOM = "#132130"
PANEL_FILL = "#101922"
PANEL_BORDER = "#304152"
ACCENT = "#4CFF93"
WARM = "#FFB84D"
TEXT = "#F4F8FC"
TEXT_MUTED = "#B4C1CE"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    width, height = size
    top_rgb = ImageColor.getrgb(top)
    bottom_rgb = ImageColor.getrgb(bottom)
    image = Image.new("RGBA", size)
    pixels = image.load()
    for y in range(height):
      t = y / max(height - 1, 1)
      color = tuple(lerp(top_rgb[index], bottom_rgb[index], t) for index in range(3)) + (255,)
      for x in range(width):
        pixels[x, y] = color
    return image


def add_glow(base: Image.Image, center: tuple[float, float], radius: int, color: str, alpha: int) -> None:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    rgba = ImageColor.getrgb(color) + (alpha,)
    x, y = center
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=rgba)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius // 2))
    base.alpha_composite(overlay)


def draw_capture_icon(size: int) -> Image.Image:
    canvas = gradient((size, size), BG_TOP, BG_BOTTOM)
    add_glow(canvas, (size * 0.28, size * 0.24), int(size * 0.22), ACCENT, 95)
    add_glow(canvas, (size * 0.78, size * 0.76), int(size * 0.2), WARM, 88)

    draw = ImageDraw.Draw(canvas)
    outer_margin = int(size * 0.11)
    outer_radius = int(size * 0.22)
    outer_box = (outer_margin, outer_margin, size - outer_margin, size - outer_margin)
    draw.rounded_rectangle(outer_box, radius=outer_radius, fill=PANEL_FILL, outline=PANEL_BORDER, width=max(2, size // 64))

    inner_margin = int(size * 0.18)
    inner_radius = int(size * 0.18)
    inner_box = (inner_margin, inner_margin, size - inner_margin, size - inner_margin)
    draw.rounded_rectangle(
        inner_box,
        radius=inner_radius,
        fill=(15, 25, 36, 220),
        outline=(66, 87, 110, 255),
        width=max(2, size // 96),
    )

    line_width = max(4, size // 36)
    corner = int(size * 0.14)
    inset = int(size * 0.24)
    right = size - inset
    bottom = size - inset
    left = inset
    top = inset
    line_color = ImageColor.getrgb(TEXT_MUTED) + (255,)

    draw.line((left, top + corner, left, top), fill=line_color, width=line_width)
    draw.line((left, top, left + corner, top), fill=line_color, width=line_width)
    draw.line((right - corner, top, right, top), fill=line_color, width=line_width)
    draw.line((right, top, right, top + corner), fill=line_color, width=line_width)
    draw.line((left, bottom - corner, left, bottom), fill=line_color, width=line_width)
    draw.line((left, bottom, left + corner, bottom), fill=line_color, width=line_width)
    draw.line((right - corner, bottom, right, bottom), fill=line_color, width=line_width)
    draw.line((right, bottom - corner, right, bottom), fill=line_color, width=line_width)

    center = size / 2
    radius = size * 0.145
    draw.ellipse(
        (center - radius, center - radius, center + radius, center + radius),
        outline=ImageColor.getrgb(ACCENT),
        width=max(4, size // 42),
    )

    dot_radius = size * 0.052
    dot_center = (center + size * 0.16, center - size * 0.14)
    draw.ellipse(
        (
            dot_center[0] - dot_radius,
            dot_center[1] - dot_radius,
            dot_center[0] + dot_radius,
            dot_center[1] + dot_radius,
        ),
        fill=ImageColor.getrgb(WARM),
    )

    pulse_width = max(6, size // 44)
    draw.arc(
        (
            center - size * 0.235,
            center - size * 0.235,
            center + size * 0.235,
            center + size * 0.235,
        ),
        start=220,
        end=318,
        fill=ImageColor.getrgb(ACCENT),
        width=pulse_width,
    )
    draw.arc(
        (
            center - size * 0.29,
            center - size * 0.29,
            center + size * 0.29,
            center + size * 0.29,
        ),
        start=36,
        end=118,
        fill=ImageColor.getrgb(WARM),
        width=max(4, size // 52),
    )

    return canvas


def fit_icon(size: int) -> Image.Image:
    base = draw_capture_icon(1024)
    return base.resize((size, size), Image.Resampling.LANCZOS)


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = word
        else:
            lines.append(candidate)
            current = ""
    if current:
        lines.append(current)
    return "\n".join(lines)


def promotional_tile(size: tuple[int, int], headline_size: int, subtitle_size: int, icon_size: int, meta_size: int) -> Image.Image:
    width, height = size
    tile = gradient(size, "#091019", "#121d2a")
    add_glow(tile, (width * 0.12, height * 0.24), int(min(width, height) * 0.24), ACCENT, 108)
    add_glow(tile, (width * 0.84, height * 0.74), int(min(width, height) * 0.22), WARM, 102)

    draw = ImageDraw.Draw(tile)
    panel_margin = int(height * 0.12)
    draw.rounded_rectangle(
        (panel_margin, panel_margin, width - panel_margin, height - panel_margin),
        radius=int(height * 0.12),
        fill=(13, 22, 32, 210),
        outline=(255, 255, 255, 22),
        width=max(2, height // 120),
    )

    icon = fit_icon(icon_size)
    icon_left = int(width * 0.08)
    icon_top = (height - icon_size) // 2
    tile.alpha_composite(icon, (icon_left, icon_top))

    headline_font = load_font(headline_size, bold=True)
    subtitle_font = load_font(subtitle_size)
    meta_font = load_font(meta_size)
    text_left = icon_left + icon_size + int(width * 0.05)
    headline_top = int(height * 0.24)
    text_right = width - panel_margin - int(width * 0.05)
    text_max_width = max(120, text_right - text_left)

    draw.text((text_left, headline_top), "ActionCap", font=headline_font, fill=TEXT)

    subtitle_top = headline_top + headline_size + int(height * 0.04)
    subtitle = wrap_text(
        draw,
        "Capture browser actions, network traces, and rrweb replay in one local Edge session.",
        subtitle_font,
        text_max_width,
    )
    draw.multiline_text((text_left, subtitle_top), subtitle, font=subtitle_font, fill=TEXT_MUTED, spacing=int(subtitle_size * 0.45))

    subtitle_bbox = draw.multiline_textbbox((text_left, subtitle_top), subtitle, font=subtitle_font, spacing=int(subtitle_size * 0.45))
    if width <= 500:
        return tile

    meta_top = subtitle_bbox[3] + int(height * 0.08)
    meta_line = wrap_text(draw, "Current tab · Across tabs · All windows · Replay", meta_font, text_max_width)
    footer_line = wrap_text(draw, "Local storage only · Manual start/stop · Export .bxdac archives", meta_font, text_max_width)
    draw.multiline_text((text_left, meta_top), meta_line, font=meta_font, fill=(232, 238, 246, 220), spacing=int(meta_size * 0.35))
    draw.multiline_text((text_left, meta_top + int(meta_size * 1.9)), footer_line, font=meta_font, fill=(194, 204, 216, 200), spacing=int(meta_size * 0.35))
    return tile


def save_png(image: Image.Image, path: Path) -> None:
    ensure_dir(path.parent)
    image.save(path, format="PNG")


def main() -> None:
    ensure_dir(PUBLIC_ICONS_DIR)
    ensure_dir(STORE_ASSETS_DIR)

    for size in (16, 32, 48, 128):
        save_png(fit_icon(size), PUBLIC_ICONS_DIR / f"icon{size}.png")

    save_png(fit_icon(300), STORE_ASSETS_DIR / "extension-logo-300.png")
    save_png(promotional_tile((440, 280), headline_size=40, subtitle_size=16, icon_size=104, meta_size=14), STORE_ASSETS_DIR / "small-promotional-tile-440x280.png")
    save_png(promotional_tile((1400, 560), headline_size=112, subtitle_size=36, icon_size=244, meta_size=24), STORE_ASSETS_DIR / "large-promotional-tile-1400x560.png")


if __name__ == "__main__":
    main()
