"""Generate the KYROX Day 6 system architecture diagram (SVG + high-res PNG + mobile PNG).

Creates:
1. ``how-kyrox-works.svg``        — Editable vector source (1080x1350 artboard).
2. ``how-kyrox-works.png``        — High-resolution 2160x2700 PNG export (2x supersampled).
3. ``how-kyrox-works-mobile.png`` — Social-media-ready 1080x1350 PNG export.

Color & status legend:
- Blue  (#2F6BFF): Built and verified.
- Amber (#F59E0B): Day 6 in progress / awaiting live on-chain verification.
- Grey  (#6E7684): Planned future functionality.

Pass ``--verified`` once live Base Sepolia deployment and balance verification succeed
to transition Day 6 on-chain components from Amber to Blue.
"""

from __future__ import annotations

import argparse
from html import escape
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
W, H = 1080, 1350
SCALE = 2  # Render internal canvas at 2x (2160x2700) for crisp typography & lines

# Palette
BG = (10, 11, 15)              # #0A0B0F near-black
GRID_LINE = (18, 21, 29)       # #12151D subtle architectural grid
CARD_BG = (16, 19, 27)         # #10131B standard card fill
CARD_BG_ALT = (13, 16, 23)     # #0D1017 deeper panel fill
DIVIDER = (36, 42, 56)         # #242A38 structural divider

WHITE = (245, 247, 250)        # #F5F7FA primary text
TEXT_SUB = (186, 194, 208)     # #BAC2D0 secondary text
TEXT_MUTED = (132, 141, 158)   # #848D9E muted label

# Status: Blue (Built & Verified)
BLUE = (47, 107, 255)          # #2F6BFF vivid architectural blue
BLUE_LIGHT = (122, 167, 255)   # #7AA7FF light blue text/accent
BLUE_BG = (16, 28, 56)         # #101C38 blue tinted surface
BLUE_BORDER = (52, 102, 220)   # #3466DC blue card border

# Status: Amber (In Progress / Awaiting Verification)
AMBER = (245, 158, 11)         # #F59E0B restrained amber
AMBER_LIGHT = (252, 211, 77)   # #FCD34D readable amber label
AMBER_BG = (42, 29, 12)        # #2A1D0C amber surface
AMBER_BORDER = (180, 114, 15)  # #B4720F amber border

# Status: Grey (Planned)
GREY = (110, 118, 132)         # #6E7684 muted grey
GREY_LIGHT = (160, 168, 182)   # #A0A8B6 planned text
GREY_BG = (22, 25, 33)         # #161921 planned surface
GREY_BORDER = (58, 64, 77)     # #3A404D planned border

# Safety boundary highlight
BOUNDARY_BG = (14, 23, 42)     # #0E172A deep navy callout
BOUNDARY_BORDER = (71, 126, 255)

FONT_DIR = Path(r"C:\Windows\Fonts")
FONT_REG = FONT_DIR / "segoeui.ttf"
FONT_SEMI = FONT_DIR / "seguisb.ttf"
FONT_BOLD = FONT_DIR / "segoeuib.ttf"
FONT_MONO = FONT_DIR / "consolab.ttf"
FONT_MONO_REG = FONT_DIR / "consola.ttf"


def _load_font(size: int, weight: str = "regular", mono: bool = False) -> ImageFont.FreeTypeFont:
    if mono:
        path = FONT_MONO if weight in ("bold", "semi") and FONT_MONO.exists() else FONT_MONO_REG
    elif weight == "bold":
        path = FONT_BOLD if FONT_BOLD.exists() else FONT_REG
    elif weight == "semi":
        path = FONT_SEMI if FONT_SEMI.exists() else FONT_BOLD
    else:
        path = FONT_REG
    return ImageFont.truetype(str(path), int(size * SCALE))


def _rgb_hex(rgb: tuple[int, int, int]) -> str:
    return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"


class DiagramBuilder:
    """Dual-target renderer that writes both clean editable SVG and high-DPI Pillow PNG."""

    def __init__(self, width: int = W, height: int = H) -> None:
        self.w = width
        self.h = height
        self.im = Image.new("RGB", (width * SCALE, height * SCALE), BG)
        self.draw = ImageDraw.Draw(self.im)
        self.svg_elements: list[str] = []

    def add_grid(self) -> None:
        step = 36
        for x in range(36, self.w, step):
            self.line(x, 76, x, self.h - 60, GRID_LINE, width=1)
        for y in range(96, self.h - 60, step):
            self.line(36, y, self.w - 36, y, GRID_LINE, width=1)

    def rect(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        fill: tuple[int, int, int],
        outline: tuple[int, int, int] | None = None,
        radius: float = 10,
        width: float = 1.5,
        dashed: bool = False,
    ) -> None:
        coords = (
            int(x1 * SCALE),
            int(y1 * SCALE),
            int(x2 * SCALE),
            int(y2 * SCALE),
        )
        if dashed and outline is not None:
            self.draw.rounded_rectangle(
                coords, radius=int(radius * SCALE), fill=fill, outline=None
            )
            self._draw_dashed_round_rect(x1, y1, x2, y2, outline, width=width)
        else:
            self.draw.rounded_rectangle(
                coords,
                radius=int(radius * SCALE),
                fill=fill,
                outline=outline,
                width=int(max(1, round(width * SCALE))) if outline else 0,
            )

        w_box = x2 - x1
        h_box = y2 - y1
        stroke_attr = (
            f' stroke="{_rgb_hex(outline)}" stroke-width="{width}"'
            if outline
            else ""
        )
        dash_attr = ' stroke-dasharray="6,5"' if dashed else ""
        self.svg_elements.append(
            f'  <rect x="{x1}" y="{y1}" width="{w_box}" height="{h_box}" '
            f'rx="{radius}" fill="{_rgb_hex(fill)}"{stroke_attr}{dash_attr} />'
        )

    def _draw_dashed_round_rect(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        color: tuple[int, int, int],
        width: float = 1.5,
    ) -> None:
        dash = 8
        gap = 6
        x = x1 + 8
        while x < x2 - 8:
            self.draw.line(
                (int(x * SCALE), int(y1 * SCALE), int(min(x + dash, x2 - 8) * SCALE), int(y1 * SCALE)),
                fill=color,
                width=int(width * SCALE),
            )
            self.draw.line(
                (int(x * SCALE), int(y2 * SCALE), int(min(x + dash, x2 - 8) * SCALE), int(y2 * SCALE)),
                fill=color,
                width=int(width * SCALE),
            )
            x += dash + gap
        y = y1 + 8
        while y < y2 - 8:
            self.draw.line(
                (int(x1 * SCALE), int(y * SCALE), int(x1 * SCALE), int(min(y + dash, y2 - 8) * SCALE)),
                fill=color,
                width=int(width * SCALE),
            )
            self.draw.line(
                (int(x2 * SCALE), int(y * SCALE), int(x2 * SCALE), int(min(y + dash, y2 - 8) * SCALE)),
                fill=color,
                width=int(width * SCALE),
            )
            y += dash + gap

    def line(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        fill: tuple[int, int, int],
        width: float = 1.5,
        dashed: bool = False,
    ) -> None:
        if dashed:
            dist_x = x2 - x1
            dist_y = y2 - y1
            length = (dist_x**2 + dist_y**2) ** 0.5
            if length > 0:
                ux, uy = dist_x / length, dist_y / length
                pos = 0.0
                dash, gap = 6.0, 5.0
                while pos < length:
                    end_pos = min(pos + dash, length)
                    sx, sy = x1 + ux * pos, y1 + uy * pos
                    ex, ey = x1 + ux * end_pos, y1 + uy * end_pos
                    self.draw.line(
                        (int(sx * SCALE), int(sy * SCALE), int(ex * SCALE), int(ey * SCALE)),
                        fill=fill,
                        width=int(max(1, round(width * SCALE))),
                    )
                    pos += dash + gap
        else:
            self.draw.line(
                (int(x1 * SCALE), int(y1 * SCALE), int(x2 * SCALE), int(y2 * SCALE)),
                fill=fill,
                width=int(max(1, round(width * SCALE))),
            )

        dash_attr = ' stroke-dasharray="6,5"' if dashed else ""
        self.svg_elements.append(
            f'  <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{_rgb_hex(fill)}" stroke-width="{width}"{dash_attr} />'
        )

    def circle(
        self,
        cx: float,
        cy: float,
        r: float,
        fill: tuple[int, int, int],
        outline: tuple[int, int, int] | None = None,
    ) -> None:
        self.draw.ellipse(
            (
                int((cx - r) * SCALE),
                int((cy - r) * SCALE),
                int((cx + r) * SCALE),
                int((cy + r) * SCALE),
            ),
            fill=fill,
            outline=outline,
        )
        stroke_attr = f' stroke="{_rgb_hex(outline)}" stroke-width="1.5"' if outline else ""
        self.svg_elements.append(
            f'  <circle cx="{cx}" cy="{cy}" r="{r}" fill="{_rgb_hex(fill)}"{stroke_attr} />'
        )

    def check_icon(
        self,
        cx: float,
        cy: float,
        color: tuple[int, int, int],
    ) -> None:
        """Draw a crisp vector checkmark inside a small circle."""
        self.circle(cx, cy, 6.5, fill=BLUE_BG, outline=color)
        pts = [
            (cx - 3.0, cy + 0.2),
            (cx - 0.8, cy + 2.4),
            (cx + 3.4, cy - 2.2),
        ]
        self.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], color, width=1.8)
        self.line(pts[1][0], pts[1][1], pts[2][0], pts[2][1], color, width=1.8)

    def arrow_down(
        self,
        x: float,
        y1: float,
        y2: float,
        color: tuple[int, int, int],
        width: float = 2.0,
        dashed: bool = False,
    ) -> None:
        self.line(x, y1, x, y2 - 5, color, width=width, dashed=dashed)
        head = [
            (int(x * SCALE), int(y2 * SCALE)),
            (int((x - 5) * SCALE), int((y2 - 8) * SCALE)),
            (int((x + 5) * SCALE), int((y2 - 8) * SCALE)),
        ]
        self.draw.polygon(head, fill=color)
        self.svg_elements.append(
            f'  <polygon points="{x},{y2} {x-5},{y2-8} {x+5},{y2-8}" fill="{_rgb_hex(color)}" />'
        )

    def arrow_up(
        self,
        x: float,
        y1: float,
        y2: float,
        color: tuple[int, int, int],
        width: float = 2.0,
    ) -> None:
        """Draw upward arrow from y1 (bottom) to y2 (top)."""
        self.line(x, y1, x, y2 + 5, color, width=width)
        head = [
            (int(x * SCALE), int(y2 * SCALE)),
            (int((x - 5) * SCALE), int((y2 + 8) * SCALE)),
            (int((x + 5) * SCALE), int((y2 + 8) * SCALE)),
        ]
        self.draw.polygon(head, fill=color)
        self.svg_elements.append(
            f'  <polygon points="{x},{y2} {x-5},{y2+8} {x+5},{y2+8}" fill="{_rgb_hex(color)}" />'
        )

    def arrow_left(
        self,
        x1: float,
        x2: float,
        y: float,
        color: tuple[int, int, int],
        width: float = 2.0,
        dashed: bool = False,
    ) -> None:
        """Draw leftward arrow from x1 (right) to x2 (left)."""
        self.line(x1, y, x2 + 5, y, color, width=width, dashed=dashed)
        head = [
            (int(x2 * SCALE), int(y * SCALE)),
            (int((x2 + 8) * SCALE), int((y - 5) * SCALE)),
            (int((x2 + 8) * SCALE), int((y + 5) * SCALE)),
        ]
        self.draw.polygon(head, fill=color)
        self.svg_elements.append(
            f'  <polygon points="{x2},{y} {x2+8},{y-5} {x2+8},{y+5}" fill="{_rgb_hex(color)}" />'
        )

    def arrow_right(
        self,
        x1: float,
        x2: float,
        y: float,
        color: tuple[int, int, int],
        width: float = 2.0,
        dashed: bool = False,
    ) -> None:
        """Draw rightward arrow from x1 (left) to x2 (right)."""
        self.line(x1, y, x2 - 5, y, color, width=width, dashed=dashed)
        head = [
            (int(x2 * SCALE), int(y * SCALE)),
            (int((x2 - 8) * SCALE), int((y - 5) * SCALE)),
            (int((x2 - 8) * SCALE), int((y + 5) * SCALE)),
        ]
        self.draw.polygon(head, fill=color)
        self.svg_elements.append(
            f'  <polygon points="{x2},{y} {x2-8},{y-5} {x2-8},{y+5}" fill="{_rgb_hex(color)}" />'
        )

    def text(
        self,
        x: float,
        y: float,
        value: str,
        size: int = 13,
        fill: tuple[int, int, int] = WHITE,
        weight: str = "regular",
        mono: bool = False,
        anchor: str = "la",
    ) -> None:
        font_obj = _load_font(size, weight=weight, mono=mono)
        self.draw.text(
            (int(x * SCALE), int(y * SCALE)),
            value,
            font=font_obj,
            fill=fill,
            anchor=anchor,
        )

        svg_anchor = "start"
        if anchor.startswith("m"):
            svg_anchor = "middle"
        elif anchor.startswith("r"):
            svg_anchor = "end"

        svg_y = y + size * 0.82 if anchor.endswith("a") else y + size * 0.35
        font_family = (
            "'JetBrains Mono', 'Consolas', monospace"
            if mono
            else "'Inter', 'Segoe UI', Arial, sans-serif"
        )
        font_weight = (
            "700" if weight == "bold" else ("600" if weight == "semi" else "400")
        )
        self.svg_elements.append(
            f'  <text x="{x}" y="{svg_y:.1f}" fill="{_rgb_hex(fill)}" '
            f'font-family="{font_family}" font-size="{size}" '
            f'font-weight="{font_weight}" text-anchor="{svg_anchor}">'
            f"{escape(value)}</text>"
        )

    def badge(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        label: str,
        dot_color: tuple[int, int, int],
        bg_color: tuple[int, int, int],
        border_color: tuple[int, int, int],
        text_color: tuple[int, int, int],
        font_size: int = 9,
    ) -> None:
        self.rect(x, y, x + w, y + h, fill=bg_color, outline=border_color, radius=h / 2, width=1.2)
        self.circle(x + 11, y + h / 2, 3.5, fill=dot_color)
        self.text(
            x + 20,
            y + h / 2,
            label,
            size=font_size,
            fill=text_color,
            weight="bold",
            mono=True,
            anchor="lm",
        )

    def to_svg(self) -> str:
        header = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}">\n'
            f'  <rect width="{self.w}" height="{self.h}" fill="{_rgb_hex(BG)}" />\n'
        )
        return header + "\n".join(self.svg_elements) + "\n</svg>\n"


def build_architecture_diagram(*, live_verified: bool = False) -> DiagramBuilder:
    b = DiagramBuilder(W, H)
    b.add_grid()

    # Day 6 status palette depends on whether live on-chain verification has completed
    day6_dot = BLUE if live_verified else AMBER
    day6_bg = BLUE_BG if live_verified else AMBER_BG
    day6_border = BLUE_BORDER if live_verified else AMBER_BORDER
    day6_text = BLUE_LIGHT if live_verified else AMBER_LIGHT
    day6_badge_label = "BUILT & VERIFIED" if live_verified else "IN PROGRESS · DAY 6"
    day6_contract_badge = (
        "DEPLOYED & VERIFIED" if live_verified else "AWAITING LIVE VERIFY"
    )

    # ------------------------------------------------------------------
    # 1. Top Masthead & Status Legend (y = 22..72)
    # ------------------------------------------------------------------
    b.rect(48, 22, 80, 54, fill=BLUE, outline=BLUE_LIGHT, radius=7, width=1.2)
    b.text(64, 38, "K", size=18, fill=WHITE, weight="bold", anchor="mm")
    b.text(92, 26, "KYROX", size=16, fill=WHITE, weight="bold")
    b.text(92, 43, "SYSTEM ARCHITECTURE  ·  v0.1", size=9, fill=TEXT_MUTED, weight="semi", mono=True)

    # Legend pills on top-right
    b.badge(466, 25, 162, 24, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=9)
    b.badge(638, 25, 228, 24, "IN PROGRESS / AWAITING VERIFY", AMBER, AMBER_BG, AMBER_BORDER, AMBER_LIGHT, font_size=9)
    b.badge(876, 25, 156, 24, "PLANNED ROADMAP", GREY, GREY_BG, GREY_BORDER, GREY_LIGHT, font_size=9)

    b.line(36, 68, W - 36, 68, DIVIDER, width=1.2)

    # ------------------------------------------------------------------
    # 2. Title Block (y = 82..172)
    # ------------------------------------------------------------------
    b.text(
        48,
        82,
        "OPEN-SOURCE NON-CUSTODIAL MCP SERVER FOR TOKENIZED STOCKS ON BASE",
        size=10,
        fill=BLUE_LIGHT,
        weight="bold",
        mono=True,
    )
    b.text(48, 102, "How KYROX Works", size=38, fill=WHITE, weight="bold")
    b.text(
        48,
        150,
        "AI agents read stock metadata and Base Sepolia ERC-20 wallet balances via MCP — while private keys stay with the human.",
        size=13,
        fill=TEXT_SUB,
        weight="regular",
    )

    # ------------------------------------------------------------------
    # 3. Main Architecture Spine (Left Column: x = 48..672)
    # ------------------------------------------------------------------

    # Node A: AI Agent / MCP Client (y = 186..278)
    b.rect(48, 186, 672, 278, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.rect(64, 204, 104, 244, fill=BLUE_BG, outline=BLUE_BORDER, radius=8, width=1.2)
    b.text(84, 224, "AI", size=14, fill=BLUE_LIGHT, weight="bold", mono=True, anchor="mm")
    b.text(120, 200, "AI AGENT / MCP CLIENT", size=15, fill=WHITE, weight="bold")
    b.text(
        120,
        223,
        "Claude Desktop · MCP Inspector · Compatible LLM Host",
        size=11,
        fill=TEXT_SUB,
    )
    b.text(
        120,
        245,
        "Discovers tools and sends structured JSON-RPC calls over stdio",
        size=10,
        fill=TEXT_MUTED,
        mono=True,
    )
    b.badge(508, 198, 148, 22, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)

    # Dual connectors between AI Agent and FastMCP Server (y = 278..318)
    b.arrow_down(250, 278, 318, BLUE, width=2.0)
    b.text(262, 293, "MCP Tool Call (stdio)", size=9, fill=BLUE_LIGHT, weight="semi", mono=True)
    b.arrow_up(470, 318, 278, BLUE_LIGHT, width=2.0)
    b.text(482, 293, "Structured JSON Result", size=9, fill=BLUE_LIGHT, weight="semi", mono=True)

    # Node B: KYROX FastMCP Server (y = 318..410)
    b.rect(48, 318, 672, 410, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.rect(64, 336, 104, 376, fill=BLUE_BG, outline=BLUE_BORDER, radius=8, width=1.2)
    b.text(84, 356, "MCP", size=12, fill=BLUE_LIGHT, weight="bold", mono=True, anchor="mm")
    b.text(120, 332, "KYROX FASTMCP SERVER", size=15, fill=WHITE, weight="bold")
    b.text(
        120,
        355,
        "server.py · Official MCP Python SDK v1 (FastMCP · STDIO Transport)",
        size=11,
        fill=TEXT_SUB,
    )
    b.text(
        120,
        377,
        "Registers tools · Validates boundary inputs · Includes hello_kyrox smoke tool",
        size=10,
        fill=TEXT_MUTED,
        mono=True,
    )
    b.badge(508, 330, 148, 22, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)

    # Connector FastMCP Server -> Python Tool Layer (y = 410..446)
    b.arrow_down(360, 410, 446, BLUE, width=2.0)
    b.text(374, 423, "Dispatches validated tool call", size=9, fill=TEXT_SUB, mono=True)

    # Node C: Python Tool Layer (y = 446..532)
    b.rect(48, 446, 672, 532, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.rect(64, 462, 104, 502, fill=BLUE_BG, outline=BLUE_BORDER, radius=8, width=1.2)
    b.text(84, 482, "PY", size=13, fill=BLUE_LIGHT, weight="bold", mono=True, anchor="mm")
    b.text(120, 458, "PYTHON TOOL LAYER", size=15, fill=WHITE, weight="bold")
    b.text(
        120,
        480,
        "tools/stocks.py · tools/wallet.py · Deterministic Validation & Precision Math",
        size=11,
        fill=TEXT_SUB,
    )
    b.text(
        120,
        501,
        "EIP-55 Checksum Normalization · Chain ID Gate (84532) · Decimal Base-Unit Conversion",
        size=10,
        fill=TEXT_MUTED,
        mono=True,
    )
    b.badge(508, 458, 148, 22, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)

    # Connectors from Python Tool Layer to the 3 Read-Only Tools (y = 532..568)
    b.line(146, 548, 566, 548, BLUE, width=1.5)
    b.line(360, 532, 360, 548, BLUE, width=2.0)
    b.arrow_down(146, 548, 568, BLUE, width=1.8)
    b.arrow_down(356, 548, 568, BLUE, width=1.8)
    b.arrow_down(566, 548, 568, day6_dot, width=1.8)

    # Node D: Read-Only Tools Row (y = 568..748)
    # Tool 1: get_stock_info (x = 48..244)
    b.rect(48, 568, 244, 748, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.badge(62, 582, 148, 20, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)
    b.text(62, 614, "get_stock_info", size=14, fill=WHITE, weight="bold", mono=True)
    b.text(62, 636, "Input: ticker (str)", size=10, fill=BLUE_LIGHT, mono=True)
    b.text(62, 660, "Case-insensitive lookup", size=10, fill=TEXT_SUB)
    b.text(62, 678, "for a single stock ticker", size=10, fill=TEXT_SUB)
    b.text(62, 696, "in data/stocks.json.", size=10, fill=TEXT_SUB)
    b.text(62, 722, "READ-ONLY · DAY 4", size=9, fill=TEXT_MUTED, weight="bold", mono=True)

    # Tool 2: list_stocks (x = 258..454)
    b.rect(258, 568, 454, 748, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.badge(272, 582, 148, 20, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)
    b.text(272, 614, "list_stocks", size=14, fill=WHITE, weight="bold", mono=True)
    b.text(272, 636, "Input: none ()", size=10, fill=BLUE_LIGHT, mono=True)
    b.text(272, 660, "Returns all configured", size=10, fill=TEXT_SUB)
    b.text(272, 678, "tickers, stock names &", size=10, fill=TEXT_SUB)
    b.text(272, 696, "reference values.", size=10, fill=TEXT_SUB)
    b.text(272, 722, "READ-ONLY · DAY 5", size=9, fill=TEXT_MUTED, weight="bold", mono=True)

    # Tool 3: get_wallet_balances (x = 468..672)
    b.rect(468, 568, 672, 748, fill=CARD_BG, outline=day6_border, radius=10, width=2.0)
    b.badge(482, 582, 176, 20, day6_badge_label, day6_dot, day6_bg, day6_border, day6_text, font_size=8)
    b.text(482, 614, "get_wallet_balances", size=13, fill=WHITE, weight="bold", mono=True)
    b.text(482, 636, "Input: wallet (0x...)", size=10, fill=day6_text, mono=True)
    b.text(482, 660, "Reads ERC-20 balanceOf()", size=10, fill=TEXT_SUB)
    b.text(482, 678, "& decimals() on Base", size=10, fill=TEXT_SUB)
    b.text(482, 696, "Sepolia via Web3.py.", size=10, fill=TEXT_SUB)
    b.text(482, 722, "READ-ONLY · NO SIGNATURE", size=9, fill=day6_text, weight="bold", mono=True)

    # Connectors from Tools to Data / RPC Layer (y = 748..788)
    b.arrow_down(146, 748, 788, BLUE, width=1.8)
    b.arrow_down(356, 748, 788, BLUE, width=1.8)
    b.arrow_down(570, 748, 788, day6_dot, width=2.0)

    # Node E1: Local Stock Catalogue (x = 48..410, y = 788..892)
    b.rect(48, 788, 410, 892, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.text(64, 804, "LOCAL STOCK CATALOGUE", size=13, fill=WHITE, weight="bold")
    b.badge(258, 801, 138, 20, "BUILT & VERIFIED", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)
    b.text(64, 830, "data/stocks.json", size=11, fill=BLUE_LIGHT, mono=True)
    b.text(64, 852, "Maps tAAPL, tTSLA, tNVDA to reference fixtures", size=10, fill=TEXT_SUB)
    b.text(64, 869, "& deployed Base Sepolia token_address records.", size=10, fill=TEXT_SUB)

    # Horizontal link from stocks.json token_address into Base Sepolia RPC reader
    b.arrow_right(410, 434, 840, day6_dot, width=1.6)

    # Node E2: Base Sepolia RPC (x = 434..672, y = 788..892)
    b.rect(434, 788, 672, 892, fill=CARD_BG, outline=day6_border, radius=10, width=2.0)
    b.text(450, 804, "BASE SEPOLIA RPC", size=13, fill=WHITE, weight="bold")
    b.text(450, 826, "https://sepolia.base.org", size=10, fill=day6_text, mono=True)
    b.text(450, 848, "Chain ID: 84532 (Verified)", size=10, fill=TEXT_SUB, mono=True)
    b.text(450, 868, "Web3.py read-only eth_call", size=10, fill=TEXT_MUTED)

    # Connector from Base Sepolia RPC -> Mock ERC-20 Token Contracts (y = 892..930)
    b.arrow_down(553, 892, 930, day6_dot, width=2.0)
    b.text(436, 905, "balanceOf(wallet) + decimals()", size=9, fill=day6_text, weight="semi", mono=True)

    # Node F: Mock ERC-20 Token Contracts on Base Sepolia (x = 48..672, y = 930..1076)
    b.rect(48, 930, 672, 1076, fill=CARD_BG, outline=day6_border, radius=10, width=2.0)
    b.text(
        64,
        945,
        "MOCK ERC-20 TOKEN CONTRACTS  (Base Sepolia · 84532)",
        size=13,
        fill=WHITE,
        weight="bold",
    )
    b.badge(478, 943, 178, 20, day6_contract_badge, day6_dot, day6_bg, day6_border, day6_text, font_size=8)
    b.text(
        64,
        969,
        "contracts/MockStock.sol · OpenZeppelin ERC-20 (18 decimals · 1,000 initial supply minted to deployer)",
        size=10,
        fill=TEXT_SUB,
    )

    tokens = [
        ("tAAPL", "Test Apple", "1,000 tAAPL"),
        ("tTSLA", "Test Tesla", "1,000 tTSLA"),
        ("tNVDA", "Test Nvidia", "1,000 tNVDA"),
    ]
    for idx, (sym, name, supply) in enumerate(tokens):
        tx1 = 64 + idx * 198
        tx2 = tx1 + 186
        b.rect(tx1, 994, tx2, 1062, fill=day6_bg, outline=day6_border, radius=8, width=1.4)
        b.text(tx1 + 14, 1006, sym, size=14, fill=WHITE, weight="bold", mono=True)
        b.text(tx1 + 88, 1008, name, size=10, fill=TEXT_SUB)
        b.text(tx1 + 14, 1034, f"Mint: {supply}", size=10, fill=day6_text, weight="semi", mono=True)

    # ------------------------------------------------------------------
    # 4. Right Column: External User Wallet + Planned Workflow + Safety Boundary (x = 700..1032)
    # ------------------------------------------------------------------

    # Node G: External User Wallet (x = 700..1032, y = 186..410)
    b.rect(700, 186, 1032, 410, fill=CARD_BG, outline=BLUE_BORDER, radius=10, width=1.8)
    b.badge(716, 200, 178, 22, "EXTERNAL USER WALLET", BLUE, BLUE_BG, BLUE_BORDER, BLUE_LIGHT, font_size=8)
    b.text(716, 232, "Public Wallet Input", size=16, fill=WHITE, weight="bold")
    b.text(716, 256, "User supplies only a public Ethereum", size=11, fill=TEXT_SUB)
    b.text(716, 274, "address (0x...) — no key or signature.", size=11, fill=TEXT_SUB)

    b.rect(716, 298, 1016, 396, fill=BOUNDARY_BG, outline=BLUE_BORDER, radius=8, width=1.2)
    b.check_icon(733, 320, BLUE_LIGHT)
    b.text(748, 312, "Public address input only (0x...)", size=11, fill=BLUE_LIGHT, weight="semi")
    b.check_icon(733, 347, BLUE_LIGHT)
    b.text(748, 339, "Balance read requires ZERO signature", size=11, fill=WHITE, weight="semi")
    b.check_icon(733, 374, BLUE_LIGHT)
    b.text(748, 366, "Private keys stay inside user's wallet", size=11, fill=BLUE_LIGHT, weight="semi")

    # Connector from External User Wallet -> get_wallet_balances
    b.line(686, 347, 700, 347, day6_dot, width=2.0)
    b.line(686, 347, 686, 636, day6_dot, width=2.0)
    b.arrow_left(686, 672, 636, day6_dot, width=2.0)

    # Pill label cleanly positioned to the right of the vertical line (y = 415..438)
    b.rect(700, 416, 948, 438, fill=day6_bg, outline=day6_border, radius=11, width=1.1)
    b.text(824, 427, "← Passes public wallet address (0x...)", size=9, fill=day6_text, weight="bold", mono=True, anchor="mm")

    # Node H: Planned Future Functionality — Separate Workflow (x = 700..1032, y = 446..850)
    b.rect(
        700,
        446,
        1032,
        850,
        fill=CARD_BG_ALT,
        outline=GREY_BORDER,
        radius=10,
        width=1.6,
        dashed=True,
    )
    b.badge(716, 462, 168, 22, "PLANNED  (DAYS 8–11)", GREY, GREY_BG, GREY_BORDER, GREY_LIGHT, font_size=8)
    b.text(716, 494, "Future Planned Workflow", size=15, fill=GREY_LIGHT, weight="bold")
    b.text(
        716,
        516,
        "Separate from today's read-only balance flow",
        size=10,
        fill=TEXT_MUTED,
    )

    planned_items = [
        ("get_portfolio(wallet)", "Combines balances + labelled reference values"),
        ("prepare_transaction(...)", "Builds unsigned payload only (signed: false)"),
        ("simulate_transaction(...)", "eth_call dry-run & gas check on exact intent"),
        ("Policy Enforcement", "Ticker allowlist, per-tx limits & audit logs"),
        ("Human Approval Workflow", "User reviews & signs in external wallet"),
    ]
    for idx, (p_title, p_desc) in enumerate(planned_items):
        py1 = 542 + idx * 58
        py2 = py1 + 48
        b.rect(716, py1, 1016, py2, fill=GREY_BG, outline=GREY_BORDER, radius=7, width=1.2)
        b.circle(730, py1 + 17, 3.0, fill=GREY)
        b.text(742, py1 + 9, p_title, size=11, fill=GREY_LIGHT, weight="bold", mono=True)
        b.text(952, py1 + 9, "PLANNED", size=8, fill=TEXT_MUTED, weight="bold", mono=True)
        b.text(742, py1 + 27, p_desc, size=9, fill=TEXT_MUTED)

    # Node I: Transaction Safety Boundary Callout (x = 700..1032, y = 868..1076)
    b.rect(
        700,
        868,
        1032,
        1076,
        fill=BOUNDARY_BG,
        outline=BOUNDARY_BORDER,
        radius=10,
        width=2.0,
    )
    b.text(
        718,
        886,
        "TRANSACTION SAFETY BOUNDARY",
        size=11,
        fill=BLUE_LIGHT,
        weight="bold",
        mono=True,
    )
    b.text(718, 912, "KYROX reads blockchain data.", size=14, fill=WHITE, weight="bold")
    b.text(718, 934, "The user retains control of", size=14, fill=WHITE, weight="bold")
    b.text(718, 956, "private keys and future", size=14, fill=BLUE_LIGHT, weight="bold")
    b.text(718, 978, "transaction signing.", size=14, fill=BLUE_LIGHT, weight="bold")
    b.line(718, 1006, 1014, 1006, DIVIDER, width=1.2)
    b.text(
        718,
        1018,
        "• Never requests private keys or seed phrases",
        size=10,
        fill=TEXT_SUB,
    )
    b.text(
        718,
        1038,
        "• Zero signing or broadcasting code in KYROX",
        size=10,
        fill=TEXT_SUB,
    )

    # ------------------------------------------------------------------
    # 5. Bottom End-to-End Day 6 Data Contract Strip (y = 1100..1262)
    # ------------------------------------------------------------------
    b.rect(48, 1100, 1032, 1262, fill=CARD_BG, outline=DIVIDER, radius=10, width=1.5)
    b.text(
        68,
        1116,
        "DAY 6 ON-CHAIN BALANCE READ CONTRACT  ·  get_wallet_balances(wallet) -> MCP JSON RESPONSE",
        size=10,
        fill=BLUE_LIGHT,
        weight="bold",
        mono=True,
    )

    # Left mini box: Input call
    b.rect(68, 1144, 376, 1244, fill=CARD_BG_ALT, outline=BLUE_BORDER, radius=8, width=1.2)
    b.text(84, 1156, "1. MCP TOOL REQUEST", size=9, fill=BLUE_LIGHT, weight="bold", mono=True)
    b.text(84, 1178, "get_wallet_balances(", size=11, fill=WHITE, mono=True)
    b.text(84, 1197, '  wallet="0xDeployer..."', size=11, fill=day6_text, mono=True)
    b.text(84, 1216, ")", size=11, fill=WHITE, mono=True)

    b.arrow_right(376, 412, 1194, BLUE_LIGHT, width=2.0)

    # Right mini box: Structured MCP response (fits cleanly inside 412..1012)
    b.rect(412, 1144, 1012, 1244, fill=CARD_BG_ALT, outline=day6_border, radius=8, width=1.4)
    b.text(428, 1156, "2. STRUCTURED MCP RESPONSE  (CHAIN: base-sepolia · 84532)", size=9, fill=day6_text, weight="bold", mono=True)
    b.text(
        428,
        1177,
        '{ "wallet": "0xChecksumWallet...", "chain": "base-sepolia",',
        size=10,
        fill=WHITE,
        mono=True,
    )
    b.text(
        428,
        1196,
        '  "balances": [ {"ticker": "tAAPL", "balance": 1000},',
        size=10,
        fill=day6_text,
        mono=True,
    )
    b.text(
        428,
        1215,
        '                {"ticker": "tTSLA", "balance": 1000}, {"ticker": "tNVDA", "balance": 1000} ] }',
        size=10,
        fill=day6_text,
        mono=True,
    )

    # ------------------------------------------------------------------
    # 6. Footer (y = 1284..1330)
    # ------------------------------------------------------------------
    b.line(36, 1284, W - 36, 1284, DIVIDER, width=1.2)
    b.text(48, 1302, "KYROX  ·  kyrox-mcp", size=10, fill=TEXT_MUTED, weight="bold", mono=True)
    b.text(
        540,
        1302,
        "BASE SEPOLIA TESTNET (84532)  ·  READ-ONLY ON-CHAIN BALANCE ARCHITECTURE",
        size=10,
        fill=TEXT_MUTED,
        weight="semi",
        mono=True,
        anchor="ma",
    )
    b.text(1032, 1302, "DAY 06", size=10, fill=BLUE_LIGHT, weight="bold", mono=True, anchor="ra")

    return b


def main() -> None:
    parser = argparse.ArgumentParser(description="Render KYROX Day 6 architecture diagram.")
    parser.add_argument(
        "--verified",
        action="store_true",
        help="Mark Day 6 Base Sepolia deployment & get_wallet_balances as Built & Verified (Blue).",
    )
    args = parser.parse_args()

    ROOT.mkdir(parents=True, exist_ok=True)
    builder = build_architecture_diagram(live_verified=args.verified)

    # 1. Editable SVG source
    svg_path = ROOT / "how-kyrox-works.svg"
    svg_path.write_text(builder.to_svg(), encoding="utf-8")

    # 2. High-resolution PNG export (2160x2700)
    hi_res_png_path = ROOT / "how-kyrox-works.png"
    builder.im.save(hi_res_png_path, optimize=True)

    # 3. Social-media-ready mobile PNG export (1080x1350)
    mobile_png_path = ROOT / "how-kyrox-works-mobile.png"
    mobile_im = builder.im.resize((W, H), Image.Resampling.LANCZOS)
    mobile_im.save(mobile_png_path, optimize=True)

    print(f"Saved SVG:        {svg_path}")
    print(f"Saved Hi-Res PNG: {hi_res_png_path} ({builder.im.size[0]}x{builder.im.size[1]})")
    print(f"Saved Mobile PNG: {mobile_png_path} ({mobile_im.size[0]}x{mobile_im.size[1]})")


if __name__ == "__main__":
    main()
