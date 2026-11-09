"""Render bundled Nucleo Glass SVGs for navigation and homepage icons up to 40pt.

Run with system Python (PyGObject, Pycairo, and librsvg installed):
    python3 scripts/render-navigation-icons.py

Artwork: https://nucleoapp.com/svg-glass-icons
License: https://nucleoapp.com/license
SVG source mirror: https://github.com/tinglinzh/nucleo-glass-icons/blob/main/public/icons/index.json
Original shapes, masks, and gradients are retained; selected colors are customized.
"""

from pathlib import Path
import sys

import cairo
import gi

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

ASSETS = Path(__file__).resolve().parent.parent / "assets/icons/nucleo-glass"
SELECTED_COLORS = {
    "#575757": "#649df8",
    "#151515": "#0375cf",
    "#E3E3E5": "#e3edff",
    "#BBBBC0": "#a3bef2",
}

for path in sorted(ASSETS.glob("*.svg")):
    if len(sys.argv) > 1 and path.stem not in sys.argv[1:]:
        continue
    original = path.read_text()
    # Neutral artwork is light so the glass shapes stay visible on the dark app surfaces.
    variants = {"": {
        "#575757": "#D5DCE8",
        "#151515": "#F4F7FC",
        "#E3E3E5": "#9AABC4",
        "#BBBBC0": "#66758F",
    }, "-selected": SELECTED_COLORS}
    if path.stem == "circle-arrow-up":
        variants["-positive"] = dict(zip(SELECTED_COLORS, ["#58dba4", "#0c9a63", "#e0fff1", "#99dabc"]))
    if path.stem == "circle-arrow-down":
        variants["-negative"] = dict(zip(SELECTED_COLORS, ["#f58da4", "#d7395d", "#ffe6ed", "#e8afbc"]))
    if path.stem == "paper-plane":
        variants["-orange"] = dict(zip(SELECTED_COLORS, ["#ffb15c", "#e77820", "#fff0df", "#f6bd86"]))
        variants["-blue"] = {"#575757": "#2800ff", "#151515": "#0005ff"}
    if path.stem in {"users", "user"}:
        variants["-blue"] = dict(zip(SELECTED_COLORS, ["#6aaeff", "#2872dc", "#e6f2ff", "#a3c8f4"]))
    for suffix, colors in variants.items():
        svg = original
        for old, new in colors.items():
            svg = svg.replace(old, new)
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 120, 120)
        handle = Rsvg.Handle.new_from_data(svg.encode())
        viewport = Rsvg.Rectangle()
        viewport.x = viewport.y = 0
        viewport.width = viewport.height = 120
        handle.render_document(cairo.Context(surface), viewport)
        surface.write_to_png(str(path.with_name(f"{path.stem}{suffix}.png")))
