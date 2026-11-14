"""Build the 3D wordmark's small typeface subset from the self-hosted OFL font.
Run with fonttools installed in an isolated Python environment; no runtime dependency.
"""
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen

web = Path(__file__).resolve().parents[1]
font = TTFont(web / "public/play/space-grotesk-variable.ttf")
glyphs = font.getGlyphSet(location={"wght": 700})
cmap = font.getBestCmap()
scale = 1000 / font["head"].unitsPerEm

class OutlinePen(BasePen):
    def __init__(self):
        super().__init__(glyphs)
        self.commands = []
        self.start = (0, 0)
    def point(self, p):
        return " ".join(str(round(v * scale, 3)) for v in p)
    def _moveTo(self, p):
        self.start = p
        self.commands.append("m " + self.point(p))
    def _lineTo(self, p):
        self.commands.append("l " + self.point(p))
    def _qCurveToOne(self, control, end):
        self.commands.append("q " + self.point(end) + " " + self.point(control))
    def _curveToOne(self, a, b, end):
        self.commands.append("b " + self.point(end) + " " + self.point(a) + " " + self.point(b))
    def _closePath(self):
        self._lineTo(self.start)
    def _endPath(self):
        pass

subset = {}
for char in sorted(set("mr.fund®?")):
    glyph = glyphs[cmap[ord(char)]]
    pen = OutlinePen()
    glyph.draw(pen)
    bounds = BoundsPen(glyphs)
    glyph.draw(bounds)
    xmin, _, xmax, _ = bounds.bounds or (0, 0, 0, 0)
    subset[char] = {"ha": glyph.width * scale, "x_min": xmin * scale, "x_max": xmax * scale, "o": " ".join(pen.commands)}
head = font["head"]
data = {
    "glyphs": subset, "familyName": "Mr Fund Wordmark", "resolution": 1000,
    "ascender": font["hhea"].ascent * scale, "descender": font["hhea"].descent * scale,
    "underlinePosition": -100, "underlineThickness": 50,
    "boundingBox": {"xMin": head.xMin * scale, "xMax": head.xMax * scale, "yMin": head.yMin * scale, "yMax": head.yMax * scale},
    "original_font_information": {
        "source": "Space Grotesk, weight 700, glyph subset for mr.fund and registration mark",
        "copyright": "Copyright 2018 The Space Grotesk Project Authors",
        "license": "SIL Open Font License 1.1; public/play/licenses/SpaceGrotesk-OFL.txt",
    },
}
out = web / "src/play/assets/wordmark.typeface.json"
out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"{out}: {out.stat().st_size} bytes")
