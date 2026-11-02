"""Render the bundled Nucleo Isometric SVGs into tinted PNGs for GlassIcon.

Run with system Python (Pycairo, PyGObject and librsvg installed):
    python3 scripts/render-isometric-icons.py

Artwork: https://nucleoapp.com/svg-isometric-icons (npm: nucleo-isometric, by Nucleo)
License: https://nucleoapp.com/license
Sources live in assets/icons/nucleo-isometric/svg/<slot>.svg, named after GlassIcon slots.
Each icon has 1px line work in currentColor and "color-2" tint paths at 30% opacity.
"""

from pathlib import Path
import re

import cairo
import gi

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

ICONS = Path(__file__).resolve().parent.parent / "assets/icons/nucleo-isometric"
SIZE = 144  # 3x density for icons up to 48pt

# suffix: (line colour, tint colour)
TONES = {
    "": ("#1E293B", "#0066FF"),          # neutral: slate lines, brand-blue tint
    "-selected": ("#0066FF", "#0066FF"),  # selected / pressed
    "-blue": ("#0066FF", "#0066FF"),
    "-orange": ("#C2410C", "#F28C28"),
}

ELEMENT = re.compile(r"<[a-z]+\b[^>]*>")


def colorize(svg: str, line: str, tint: str) -> str:
    def element(match: re.Match) -> str:
        tag = match.group(0)
        return tag.replace("currentColor", tint if 'data-color="color-2"' in tag else line)
    return ELEMENT.sub(element, svg)


for path in sorted((ICONS / "svg").glob("*.svg")):
    source = path.read_text()
    for suffix, (line, tint) in TONES.items():
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, SIZE, SIZE)
        handle = Rsvg.Handle.new_from_data(colorize(source, line, tint).encode())
        viewport = Rsvg.Rectangle()
        viewport.x = viewport.y = 0
        viewport.width = viewport.height = SIZE
        handle.render_document(cairo.Context(surface), viewport)
        surface.write_to_png(str(ICONS / f"{path.stem}{suffix}.png"))
    print("rendered", path.stem)
