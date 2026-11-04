#!/usr/bin/env python3
"""Generate JelHR's original illustrations, icons and social image.

SVG sources are written to design/illustrations/ and rendered to high-quality WebP
(2x density) in frontend/assets/img/. Requires `rsvg-convert` (librsvg) and Pillow.

    python3 scripts/generate-images.py
"""
import io
import math
import os
import random
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "illustrations"
OUT = ROOT / "frontend" / "assets" / "img"
FRONT = ROOT / "frontend"

INK, INK2 = "#292929", "#3b3b3a"
YELLOW, YELLOW_D, WARM = "#ffdb5d", "#f2c230", "#ffedb3"
CREAM, PAPER, STONE, MIST, SLATE = "#f5edcf", "#faf8ee", "#deddd8", "#e5e6e7", "#a5acb5"
WHITE = "#ffffff"
SKIN = ["#f1c7a5", "#c98e6b", "#8d5b3e", "#e9b48c", "#b77a55"]
HAIR = ["#292929", "#5b3a29", "#3b2a20", "#8a5a3c"]


def svg(w, h, body, bg=True):
    defs = f"""<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eceae4"/><stop offset=".6" stop-color="#e8e6e0"/><stop offset="1" stop-color="{CREAM}"/></linearGradient>
<radialGradient id="glow" cx=".82" cy=".78" r=".6"><stop offset="0" stop-color="{WARM}"/><stop offset="1" stop-color="{WARM}" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#292929" flood-opacity=".12"/></filter>
<filter id="lift" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#292929" flood-opacity=".14"/></filter>
</defs>"""
    back = f'<rect width="{w}" height="{h}" rx="48" fill="url(#bg)"/><rect width="{w}" height="{h}" rx="48" fill="url(#glow)"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{defs}{back}{body}</svg>'


def person(x, y, s=1.0, skin=0, hair=0, shirt=INK, style="short", arm=None, flip=False):
    """Stylised half-figure. (x, y) = centre of shoulders."""
    sk, hr = SKIN[skin % len(SKIN)], HAIR[hair % len(HAIR)]
    t = f'translate({x} {y}) scale({-s if flip else s} {s})'
    hair_shape = {
        "short": f'<path d="M-30 -86c0-26 14-40 32-40s30 14 30 34c-8-10-22-14-40-12-10 1-17 7-22 18z" fill="{hr}"/>',
        "long": f'<path d="M-34 -78c-4-34 12-50 34-50s36 16 34 46c0 22 4 40 10 52h-24l-2-50c-6-14-20-20-36-18-4 18-6 38-4 66h-22c8-12 12-26 10-46z" fill="{hr}"/>',
        "bun": f'<circle cx="0" cy="-138" r="15" fill="{hr}"/><path d="M-31 -88c-2-26 12-40 31-40s33 14 31 40c-8-12-20-17-31-17s-23 5-31 17z" fill="{hr}"/>',
        "curly": "".join(f'<circle cx="{cx}" cy="{cy}" r="13" fill="{hr}"/>' for cx, cy in [(-24,-104),(-12,-120),(6,-124),(22,-114),(30,-98),(-30,-88)]),
    }[style]
    arms = ""
    if arm == "wave":
        arms = f'<path d="M34 -6c18-10 28-34 30-62" stroke="{shirt}" stroke-width="22" stroke-linecap="round" fill="none"/><circle cx="64" cy="-74" r="12" fill="{sk}"/>'
    elif arm == "hold":
        arms = f'<path d="M-36 0c-6 26 4 44 30 50M36 0c6 26-4 44-30 50" stroke="{shirt}" stroke-width="20" stroke-linecap="round" fill="none"/>'
    elif arm == "point":
        arms = f'<path d="M34 -2c22 4 40 0 58-14" stroke="{shirt}" stroke-width="20" stroke-linecap="round" fill="none"/><circle cx="96" cy="-18" r="11" fill="{sk}"/>'
    return f'''<g transform="{t}">
<path d="M-62 120c0-80 26-122 62-122s62 42 62 122z" fill="{shirt}"/>
<path d="M-14 -2c0 12 6 20 14 20s14-8 14-20" fill="{PAPER}" opacity=".9"/>
<rect x="-11" y="-30" width="22" height="30" rx="9" fill="{sk}"/>
<ellipse cx="0" cy="-74" rx="31" ry="36" fill="{sk}"/>
{hair_shape}
<circle cx="-11" cy="-72" r="3" fill="{INK}"/><circle cx="11" cy="-72" r="3" fill="{INK}"/>
<path d="M-9 -56c5 5 13 5 18 0" stroke="{INK}" stroke-width="3" stroke-linecap="round" fill="none"/>
{arms}</g>'''


def card(x, y, w, h, fill=WHITE, rx=28, extra="", filt="soft"):
    return f'<g filter="url(#{filt})"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"/></g>{extra}'


def lines(x, y, widths, gap=22, color=STONE, h=10):
    return "".join(f'<rect x="{x}" y="{y + i * gap}" width="{w}" height="{h}" rx="{h/2}" fill="{color}"/>' for i, w in enumerate(widths))


def check(cx, cy, r=18, fill=YELLOW, stroke=INK):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/><path d="M{cx - r*.42} {cy + r*.02} l{r*.3} {r*.3} l{r*.55} {-r*.6}" stroke="{stroke}" stroke-width="{max(3, r*.2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'


def dots(seed, n, w, h, colors=(YELLOW, INK, STONE), rmin=4, rmax=9, box=None):
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box or (40, 40, w - 40, h - 40)
    return "".join(f'<circle cx="{rnd.uniform(x0, x1):.0f}" cy="{rnd.uniform(y0, y1):.0f}" r="{rnd.uniform(rmin, rmax):.1f}" fill="{rnd.choice(colors)}" opacity="{rnd.uniform(.5, 1):.2f}"/>' for _ in range(n))


def plant(x, y, s=1):
    return f'''<g transform="translate({x} {y}) scale({s})">
<path d="M0 0c-6-40-40-54-58-50 4 26 26 46 58 50z" fill="#8fa37a"/><path d="M4 -4c6-44 34-62 56-58-2 30-26 52-56 58z" fill="#a9b98f"/>
<path d="M0 0c2-36-6-62-22-82 -8 30-4 58 22 82z" fill="#7d9468"/>
<path d="M-34 0h68l-10 56h-48z" fill="{INK}"/><rect x="-38" y="-6" width="76" height="14" rx="7" fill="{INK2}"/></g>'''


def scene_onboarding():
    W, H = 800, 600
    b = f'<circle cx="600" cy="140" r="90" fill="{YELLOW}" opacity=".55"/>'
    b += dots(11, 16, W, H, box=(80, 40, 760, 260))
    b += card(330, 120, 380, 360, extra=
        f'<rect x="330" y="120" width="380" height="86" rx="28" fill="{INK}"/><rect x="330" y="176" width="380" height="30" fill="{INK}"/>'
        f'<text x="362" y="174" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="30" fill="{WHITE}">Welcome aboard</text>'
        + "".join(check(376, 252 + i * 62, 17, YELLOW if i < 2 else STONE, INK if i < 2 else "#9b9a94") + lines(408, 244 + i * 62, [190 - i * 18], h=14, color=STONE if i >= 2 else "#cfcec8") for i in range(4)))
    b += person(200, 380, 1.15, skin=1, hair=0, shirt=YELLOW_D, style="curly", arm="wave")
    b += plant(700, 520, .9)
    b += f'<rect x="60" y="500" width="680" height="16" rx="8" fill="{STONE}"/>'
    return svg(W, H, b)


def scene_offboarding():
    W, H = 800, 600
    b = f'<circle cx="150" cy="150" r="80" fill="{YELLOW}" opacity=".5"/>'
    # door
    b += card(500, 90, 220, 410, fill=INK, rx=26, extra=f'<rect x="530" y="122" width="160" height="350" rx="16" fill="{INK2}"/><path d="M690 122 L720 108 L720 486 L690 472z" fill="{YELLOW}"/><circle cx="670" cy="300" r="8" fill="{YELLOW}"/>')
    b += f'<path d="M546 300h70" stroke="{YELLOW}" stroke-width="8" stroke-linecap="round"/><path d="M596 278l22 22-22 22" stroke="{YELLOW}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
    # person carrying a box
    b += person(330, 360, 1.1, skin=3, hair=1, shirt=SLATE, style="long", arm="hold")
    b += f'<g filter="url(#lift)"><rect x="268" y="388" width="124" height="88" rx="10" fill="#d9b98a"/></g><path d="M268 410h124" stroke="#c4a173" stroke-width="5"/><rect x="314" y="400" width="32" height="12" rx="4" fill="{CREAM}"/>'
    b += f'<rect x="296" y="368" width="28" height="22" rx="4" fill="{INK}"/><rect x="330" y="360" width="40" height="30" rx="5" fill="{YELLOW}"/>'
    # checklist chip
    b += card(70, 300, 170, 170, extra=check(110, 344, 15) + lines(134, 337, [80], h=12) + check(110, 392, 15) + lines(134, 385, [64], h=12) + check(110, 440, 15, STONE, "#9b9a94") + lines(134, 433, [72], h=12))
    b += f'<rect x="60" y="500" width="680" height="16" rx="8" fill="{STONE}"/>'
    b += dots(7, 10, W, H, box=(220, 60, 480, 220))
    return svg(W, H, b)


def scene_esign():
    W, H = 800, 600
    b = f'<circle cx="640" cy="460" r="110" fill="{YELLOW}" opacity=".45"/>'
    b += f'<g transform="rotate(-6 400 300)">' + card(210, 70, 360, 460, extra=
        lines(250, 120, [200, 270, 250, 280, 230, 160], gap=30, h=12)
        + f'<rect x="250" y="330" width="280" height="110" rx="16" fill="{PAPER}" stroke="{STONE}" stroke-width="3" stroke-dasharray="10 10"/>'
        + f'<path d="M272 410c26 0 34-40 46-66 10-22 22-12 14 12-8 24-4 46 14 34 16-10 22-30 36-30 12 0 6 22 20 22 12 0 22-14 40-20" stroke="{INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
        + lines(250, 470, [120], h=10)) + '</g>'
    # pen
    b += f'<g transform="translate(560 380) rotate(38)" filter="url(#lift)"><rect x="-14" y="-170" width="28" height="170" rx="12" fill="{YELLOW}"/><rect x="-14" y="-170" width="28" height="36" rx="10" fill="{INK}"/><path d="M-14 0h28l-14 34z" fill="{INK2}"/><circle cx="0" cy="30" r="3" fill="{YELLOW}"/></g>'
    # verified badge
    b += f'<g filter="url(#lift)"><circle cx="180" cy="430" r="70" fill="{INK}"/></g><circle cx="180" cy="430" r="54" fill="none" stroke="{YELLOW}" stroke-width="4" stroke-dasharray="6 8"/>' + check(180, 430, 30)
    b += dots(3, 12, W, H, box=(60, 60, 220, 300))
    return svg(W, H, b)


def scene_communications():
    W, H = 800, 600
    b = f'<circle cx="160" cy="470" r="90" fill="{YELLOW}" opacity=".45"/>'
    # envelope
    b += card(250, 200, 320, 220, extra=f'<path d="M250 228 410 330 570 228" stroke="{STONE}" stroke-width="8" fill="none" stroke-linejoin="round"/><path d="M250 396 370 306M570 396 450 306" stroke="{MIST}" stroke-width="6"/>')
    b += f'<g filter="url(#lift)"><rect x="300" y="120" width="220" height="150" rx="18" fill="{PAPER}"/></g>' + lines(326, 150, [140, 168, 110], gap=26, h=12)
    b = b.replace(f'<g filter="url(#lift)"><rect x="300"', f'<g filter="url(#lift)"><rect x="300"')
    # speech bubbles + avatars
    for i, (cx, cy, col) in enumerate([(640, 150, YELLOW), (680, 300, INK), (620, 440, STONE)]):
        b += f'<g filter="url(#lift)"><circle cx="{cx}" cy="{cy}" r="42" fill="{col}"/></g>'
        sk = SKIN[i + 1]
        b += f'<circle cx="{cx}" cy="{cy - 8}" r="14" fill="{sk}"/><path d="M{cx - 22} {cy + 26}c4-18 12-24 22-24s18 6 22 24z" fill="{sk}"/>'
        b += f'<path d="M572 {cy}h{cx - 616}" stroke="{SLATE}" stroke-width="4" stroke-dasharray="4 10" stroke-linecap="round"/>'
    # megaphone
    b += f'<g transform="translate(150 200) rotate(-14)"><path d="M0 40v-40l110-50v140z" fill="{INK}"/><rect x="-34" y="-6" width="40" height="52" rx="10" fill="{YELLOW_D}"/><path d="M130 -30c24 20 24 60 0 80" stroke="{INK}" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M-18 46l10 46h24l-6-46" fill="{INK2}"/></g>'
    b += dots(21, 12, W, H, box=(80, 40, 760, 140))
    return svg(W, H, b)


def scene_dashboard():
    W, H = 800, 600
    b = f'<circle cx="680" cy="120" r="80" fill="{YELLOW}" opacity=".5"/>'
    b += card(210, 100, 400, 300, extra=
        f'<rect x="240" y="130" width="120" height="14" rx="7" fill="{INK}"/>'
        + "".join(f'<rect x="{252 + i * 44}" y="{360 - hgt}" width="28" height="{hgt}" rx="10" fill="{c}"/>' for i, (hgt, c) in enumerate([(70, STONE), (120, YELLOW), (90, STONE), (170, INK), (130, YELLOW), (60, STONE)]))
        + f'<circle cx="540" cy="250" r="44" fill="none" stroke="{STONE}" stroke-width="18"/><circle cx="540" cy="250" r="44" fill="none" stroke="{YELLOW}" stroke-width="18" stroke-dasharray="190 300" transform="rotate(-90 540 250)" stroke-linecap="round"/>')
    b += person(150, 420, 1.05, skin=0, hair=2, shirt=INK, style="bun", arm="point")
    b += person(690, 440, 1.0, skin=2, hair=0, shirt=YELLOW_D, style="short", flip=True)
    b += person(420, 500, .9, skin=4, hair=3, shirt=SLATE, style="long")
    b += f'<rect x="40" y="560" width="720" height="16" rx="8" fill="{STONE}"/>'
    return svg(W, H, b)


def scene_security():
    W, H = 800, 600
    b = f'<circle cx="560" cy="160" r="96" fill="{YELLOW}" opacity=".5"/>'
    b += f'<g filter="url(#soft)"><path d="M400 80 250 136v118c0 96 62 166 150 196 88-30 150-100 150-196V136z" fill="{INK}"/></g>'
    b += f'<path d="M400 120 290 162v92c0 72 46 126 110 150 64-24 110-78 110-150v-92z" fill="{INK2}"/>'
    b += f'<rect x="350" y="250" width="100" height="84" rx="16" fill="{YELLOW}"/><path d="M370 250v-22a30 30 0 0 1 60 0v22" stroke="{YELLOW}" stroke-width="12" fill="none"/><circle cx="400" cy="288" r="10" fill="{INK}"/><rect x="396" y="292" width="8" height="22" rx="4" fill="{INK}"/>'
    for i, y in enumerate([200, 300, 400]):
        b += card(600, y - 30, 150, 64, rx=20, filt="lift", extra=f'<circle cx="630" cy="{y + 2}" r="14" fill="{[YELLOW, STONE, STONE][i]}"/>' + lines(654, y - 4, [70], h=10))
        b += card(50, y - 30, 150, 64, rx=20, filt="lift", extra=check(82, y + 2, 14) + lines(106, y - 4, [66], h=10))
    b += f'<rect x="40" y="520" width="720" height="16" rx="8" fill="{STONE}"/>'
    return svg(W, H, b)


def scene_empty():
    W, H = 800, 600
    b = f'<ellipse cx="400" cy="470" rx="240" ry="26" fill="{STONE}"/>'
    b += f'<g filter="url(#soft)"><path d="M210 300 270 170h260l60 130v140a26 26 0 0 1-26 26H236a26 26 0 0 1-26-26z" fill="{WHITE}"/></g>'
    b += f'<path d="M210 300h120l24 42h92l24-42h120" stroke="{STONE}" stroke-width="10" fill="none" stroke-linejoin="round"/>'
    b += f'<path d="M400 90c5 36 30 62 66 66-36 5-61 30-66 66-5-36-30-61-66-66 36-4 61-30 66-66z" fill="{YELLOW}"/>'
    b += f'<path d="M560 120c3 18 15 30 33 33-18 3-30 15-33 33-3-18-15-30-33-33 18-3 30-15 33-33z" fill="{INK}"/>'
    b += f'<path d="M250 110c2 12 10 20 22 22-12 2-20 10-22 22-2-12-10-20-22-22 12-2 20-10 22-22z" fill="{SLATE}"/>'
    return svg(W, H, b)


def scene_notfound():
    W, H = 800, 600
    b = f'<circle cx="400" cy="250" r="170" fill="{YELLOW}" opacity=".35"/>'
    b += f'<rect x="388" y="150" width="24" height="340" rx="10" fill="{INK}"/>'
    b += f'<g filter="url(#lift)"><path d="M250 170h230l40 34-40 34H250z" fill="{YELLOW}"/></g><text x="282" y="216" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="34" font-weight="700" fill="{INK}">404</text>'
    b += f'<g filter="url(#lift)"><path d="M560 270H330l-40 34 40 34h230z" fill="{WHITE}"/></g>' + lines(350, 298, [150], h=12)
    b += f'<ellipse cx="400" cy="500" rx="200" ry="22" fill="{STONE}"/>'
    b += plant(190, 470, .8) + plant(620, 470, .7)
    return svg(W, H, b)


def scene_platform():
    W, H = 800, 600
    b = f'<circle cx="170" cy="150" r="90" fill="{YELLOW}" opacity=".45"/>'
    tiles = [(300, 110, INK), (450, 110, YELLOW), (300, 260, STONE), (450, 260, INK), (600, 260, YELLOW), (450, 410, STONE)]
    for x, y, c in tiles:
        b += card(x, y, 130, 130, fill=c, rx=26, filt="lift", extra=f'<rect x="{x + 28}" y="{y + 40}" width="74" height="60" rx="8" fill="{WHITE}" opacity=".85"/>' + "".join(f'<rect x="{x + 38 + i * 20}" y="{y + 52}" width="12" height="12" rx="3" fill="{c if c != WHITE else STONE}"/>' for i in range(3)))
    b += f'<path d="M365 240v20M515 240v20M565 325h35M515 390v20" stroke="{SLATE}" stroke-width="6" stroke-linecap="round"/>'
    b += person(160, 420, 1.05, skin=1, hair=0, shirt=INK, style="short", arm="point")
    b += f'<rect x="40" y="560" width="720" height="16" rx="8" fill="{STONE}"/>'
    return svg(W, H, b)


def og_image():
    W, H = 1200, 630
    b = f'<rect width="{W}" height="{H}" fill="{SLATE}"/>'
    b += f'<rect x="24" y="24" width="{W - 48}" height="{H - 48}" rx="56" fill="url(#bg)"/><rect x="24" y="24" width="{W - 48}" height="{H - 48}" rx="56" fill="url(#glow)"/>'
    b += f'<rect x="84" y="86" width="230" height="66" rx="33" fill="none" stroke="#858989" stroke-width="2"/><text x="112" y="132" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="38" letter-spacing="-1.5" fill="{INK}">JelHR</text><text x="226" y="126" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2" fill="{INK}">HRIS</text>'
    b += f'<text x="84" y="290" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="72" letter-spacing="-3" fill="{INK}">Good work</text><text x="84" y="372" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="72" letter-spacing="-3" fill="{INK}">starts with people.</text>'
    b += f'<text x="86" y="440" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="24" fill="#6b6a63">People, onboarding, offboarding, e-signatures and updates.</text>'
    for i, (label, fill, color) in enumerate([("People", INK, WHITE), ("Offboarding", YELLOW, INK), ("E-sign", STONE, INK)]):
        x = 84 + i * 190
        b += f'<rect x="{x}" y="490" width="176" height="56" rx="28" fill="{fill}"/><text x="{x + 88}" y="525" text-anchor="middle" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="20" fill="{color}">{label}</text>'
    b += f'<g transform="translate(760 120) scale(.62)">{scene_esign_body()}</g>'
    return svg(W, H, b, bg=False)


def scene_esign_body():
    s = scene_esign()
    s = s.replace(f'<circle cx="640" cy="460" r="110" fill="{YELLOW}" opacity=".45"/>', "")
    return s[s.index("</defs>") + 7: s.rindex("</svg>")].replace('rx="48" fill="url(#bg)"', 'rx="48" fill="#fff" fill-opacity="0"').replace('fill="url(#glow)"', 'fill="none"')


def favicon_svg(size=64):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}">
<rect x="2" y="2" width="60" height="60" rx="18" fill="{INK}"/>
<path d="M39 17v18.5a9.5 9.5 0 0 1-19 0" fill="none" stroke="{YELLOW}" stroke-width="7" stroke-linecap="round"/>
<circle cx="47.5" cy="17" r="4.5" fill="{CREAM}"/>
</svg>'''


def maskable_svg():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" fill="{INK}"/>
<path d="M37 21v14a8 8 0 0 1-16 0" fill="none" stroke="{YELLOW}" stroke-width="6" stroke-linecap="round"/>
<circle cx="44" cy="21" r="3.8" fill="{CREAM}"/>
</svg>'''


def render(svg_text, width, height=None):
    args = ["rsvg-convert", "-w", str(width)] + (["-h", str(height)] if height else []) + ["-f", "png"]
    png = subprocess.run(args, input=svg_text.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def save_webp(img, path, quality=90):
    img.save(path, "WEBP", quality=quality, method=6, exact=False)
    return os.path.getsize(path)


def main():
    SRC.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    scenes = {
        "onboarding": scene_onboarding, "offboarding": scene_offboarding, "esign": scene_esign,
        "communications": scene_communications, "dashboard": scene_dashboard, "security": scene_security,
        "empty": scene_empty, "not-found": scene_notfound, "platform": scene_platform,
    }
    for name, fn in scenes.items():
        text = fn()
        (SRC / f"{name}.svg").write_text(text)
        size = save_webp(render(text, 1600), OUT / f"{name}.webp")
        print(f"{name}.webp  {size // 1024} KB")
    og = og_image()
    (SRC / "og-image.svg").write_text(og)
    img = render(og, 1200, 630).convert("RGB")
    img.save(OUT / "og-image.png", optimize=True)
    save_webp(img, OUT / "og-image.webp", 90)
    fav = favicon_svg()
    (FRONT / "favicon.svg").write_text(fav)
    render(fav, 180).save(FRONT / "apple-touch-icon.png", optimize=True)
    render(fav, 192).save(OUT / "icon-192.png", optimize=True)
    render(fav, 512).save(OUT / "icon-512.png", optimize=True)
    render(maskable_svg(), 512).save(OUT / "icon-maskable-512.png", optimize=True)
    ico = render(fav, 256)
    ico.save(FRONT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons written")


if __name__ == "__main__":
    main()
