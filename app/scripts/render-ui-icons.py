"""Render the flat outline UI icons in assets/icons/ui to white PNGs at 3x (54px for an 18pt icon).

Run with system Python (PyGObject, Pycairo, and librsvg installed):
    python3 scripts/render-ui-icons.py

The icons sit on solid accent fills, so the artwork's ink colour is swapped for white;
fill opacity in the SVG is kept, so two-tone icons stay two-tone.
"""

from pathlib import Path

import cairo
import gi

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

ASSETS = Path(__file__).resolve().parent.parent / "assets/icons/ui"
SIZE = 54

for path in sorted(ASSETS.glob("*.svg")):
    svg = path.read_text().replace("#1c1f21", "#FFFFFF")
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, SIZE, SIZE)
    viewport = Rsvg.Rectangle()
    viewport.x = viewport.y = 0
    viewport.width = viewport.height = SIZE
    Rsvg.Handle.new_from_data(svg.encode()).render_document(cairo.Context(surface), viewport)
    surface.write_to_png(str(path.with_suffix(".png")))
