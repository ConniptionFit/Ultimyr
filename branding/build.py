#!/usr/bin/env python3
"""Regenerates every file in branding/ (SVG sources, PNG exports, favicon.ico).

Needs: python3, fonttools (pip install fonttools), Chromium (CHROME env var or
the Playwright copy) and ImageMagick `convert` (favicon.ico only).
Run from anywhere: python3 branding/build.py
"""
import os, subprocess, tempfile
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = Path(__file__).resolve().parent
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
FONT = os.environ.get("BRAND_FONT", "/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf")

# Palette taken from apps/web/app/globals.css
LIGHT = dict(tile="#2f6f62", glyph="#faf7f0", ink="#1d1b16", accent="#2f6f62", bg="#faf7f0")
DARK = dict(tile="#6fb5a5", glyph="#14130f", ink="#efe9d9", accent="#6fb5a5", bg="#14130f")

BOOK = "M256 150c-36-28-84-36-130-30v236c46-6 94 2 130 30 36-28 84-36 130-30V120c-46-6-94 2-130 30z"
SPINE = "M256 150v236"
SPARK = "M256 62Q256 108 302 108Q256 108 256 154Q256 108 210 108Q256 108 256 62Z"
GROUP = 'transform="translate(256 292) scale(.88) translate(-256 -253)"'


def glyph(stroke, spark, extra=""):
    return (f'<g {extra}><g {GROUP} fill="none" stroke="{stroke}" stroke-width="22" '
            f'stroke-linecap="round" stroke-linejoin="round"><path d="{BOOK}"/><path d="{SPINE}"/></g>'
            f'<path d="{SPARK}" fill="{spark}"/></g>')


def tile_svg(p):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>Ultimyr</title>'
            f'<rect width="512" height="512" rx="112" fill="{p["tile"]}"/>{glyph(p["glyph"], p["glyph"])}</svg>\n')


def glyph_svg(color):
    # Tight crop around the glyph (no tile), for use on any background.
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 56 320 360"><title>Ultimyr</title>'
            f'{glyph(color, color)}</svg>\n')


def text_path(text, size, tracking):
    f = TTFont(FONT); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    s = size / upm; x = 0.0; d = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, 0)))
        d.append(pen.getCommands())
        x += gs[name].width * s + tracking
    return " ".join(d), x - tracking


def horizontal_svg(p):
    d, w = text_path("Ultimyr", 150, 3)
    tx = 512 + 56
    W = tx + w + 24
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 512"><title>Ultimyr</title>'
            f'<rect width="512" height="512" rx="112" fill="{p["tile"]}"/>{glyph(p["glyph"], p["glyph"])}'
            f'<path transform="translate({tx} 318)" fill="{p["ink"]}" d="{d}"/></svg>\n')


def social_svg(p):
    d, w = text_path("Ultimyr", 150, 3)
    inner = 512 + 56 + w   # width of horizontal lockup without padding
    sc = 0.8
    lw = inner * sc
    ox = (1280 - lw) / 2; oy = (640 - 512 * sc) / 2 - 20
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640"><title>Ultimyr</title>'
            f'<rect width="1280" height="640" fill="{p["bg"]}"/>'
            f'<g transform="translate({ox:.1f} {oy:.1f}) scale({sc})">'
            f'<rect width="512" height="512" rx="112" fill="{p["tile"]}"/>{glyph(p["glyph"], p["glyph"])}'
            f'<path transform="translate({512+56} 318)" fill="{p["ink"]}" d="{d}"/></g>'
            f'<text x="640" y="{oy + 512*sc + 75:.0f}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" '
            f'font-size="30" letter-spacing="1" fill="{p["ink"]}" opacity=".7">AI-first learning and certification</text></svg>\n')


def render(svg, png, w, h, transparent=True):
    with tempfile.TemporaryDirectory() as t:
        html = Path(t, "p.html")
        html.write_text(f'<html><body style="margin:0;background:transparent"><img src="file://{svg}" '
                        f'width="{w}" height="{h}" style="display:block"></body></html>')
        subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                        "--default-background-color=00000000", f"--window-size={w+400},{h+400}",
                        f"--screenshot={png}", f"file://{html}"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Headless Chromium enforces a minimum window size, so shoot big and crop.
    subprocess.run(["convert", str(png), "-crop", f"{w}x{h}+0+0", "+repage", str(png)], check=True)


def main():
    svg = OUT / "svg"; png = OUT / "png"
    svg.mkdir(exist_ok=True); png.mkdir(exist_ok=True)
    files = {
        "icon-light.svg": tile_svg(LIGHT), "icon-dark.svg": tile_svg(DARK),
        "glyph-on-light.svg": glyph_svg(LIGHT["accent"]), "glyph-on-dark.svg": glyph_svg(DARK["accent"]),
        "glyph-white.svg": glyph_svg("#ffffff"),
        "logo-horizontal-light.svg": horizontal_svg(LIGHT), "logo-horizontal-dark.svg": horizontal_svg(DARK),
        "social-preview-light.svg": social_svg(LIGHT), "social-preview-dark.svg": social_svg(DARK),
    }
    for n, c in files.items():
        (svg / n).write_text(c)
    for v in ("light", "dark"):
        for s in (16, 32, 48, 64, 128, 180, 192, 256, 512, 1024):
            render(svg / f"icon-{v}.svg", png / f"icon-{v}-{s}.png", s, s)
        render(svg / f"logo-horizontal-{v}.svg", png / f"logo-horizontal-{v}.png", 1600, round(1600 * 512 / float(
            (svg / f"logo-horizontal-{v}.svg").read_text().split('viewBox="0 0 ')[1].split(" ")[0])))
        render(svg / f"social-preview-{v}.svg", png / f"social-preview-{v}.png", 1280, 640)
    for n, w in (("glyph-on-light", 640), ("glyph-on-dark", 640)):
        render(svg / f"{n}.svg", png / f"{n}.png", w, round(w * 360 / 320))
    subprocess.run(["convert", str(png / "icon-light-16.png"), str(png / "icon-light-32.png"),
                    str(png / "icon-light-48.png"), str(OUT / "favicon.ico")], check=True)


if __name__ == "__main__":
    main()
