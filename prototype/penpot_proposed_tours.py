#!/usr/bin/env python3
"""Add Penpot page «Proposed tours» — Home coach patterns after fresh install.

Product rule: tour only after fresh install + first wallet created → Home.
Not after Reset app unless that reset was a true fresh install.

Families (board rows David can compare):
  A Coachmarks — numbered callouts / bubbles (3 variants × 5 steps)
  B Spotlight Overlay — dark scrim + cutout (3 variants × 5 steps)
  C Tooltip Tour — anchored tips, no full spotlight (3 variants × 5 steps)

Each variant is a horizontal sequence of five phone frames (steps 1–5).
Visual system matches penpot_rebuild_clean / Expo Home (black, JetBrains Mono).

Rebuild: python3 prototype/penpot_proposed_tours.py
  (creates page if missing; wipes only this page; other pages untouched)
"""
from __future__ import annotations

import importlib.util
import json
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
ROOT = "00000000-0000-0000-0000-000000000000"
BASE = "http://192.168.1.104:9001"
ENV = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
EMAIL = re.search(r"PENPOT_EMAIL=(.*)", ENV).group(1).strip()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", ENV).group(1).strip()

PAGE_NAME = "Proposed tours"
PHONE_W, PHONE_H = 390, 844
COL, ROW = 430, 980
ORIGIN_X, ORIGIN_Y = 80, 420
NOTE_W = 390
CAPTION = "#B3B3B3"
HINT = "#999999"
MUTED = "#8C8C8C"
DIM = "#000000"

_spec = importlib.util.spec_from_file_location(
    "rebuild", Path(__file__).with_name("penpot_rebuild_clean.py")
)
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

# --- tour content ------------------------------------------------------------

STEPS = [
    {
        "id": "pos",
        "n": 1,
        "title": "Open POS",
        "body": "Swipe left → right on Home to open the point-of-sale request page.",
        "short": "Swipe → POS",
        "target": "gesture_ltr",
    },
    {
        "id": "qr",
        "n": 2,
        "title": "Scan QR",
        "body": "Swipe right → left to open the QR reader.",
        "short": "Swipe ← QR",
        "target": "gesture_rtl",
    },
    {
        "id": "settings",
        "n": 3,
        "title": "Settings",
        "body": "Long-press empty header space (or tap the rate footer) for Settings.",
        "short": "Long-press header",
        "target": "settings",
    },
    {
        "id": "add_wallet",
        "n": 4,
        "title": "Add Wallet",
        "body": "Tap the avatar (top left) to switch wallets or add a new one.",
        "short": "Tap avatar",
        "target": "avatar",
    },
    {
        "id": "fiat",
        "n": 5,
        "title": "Fiat mode",
        "body": "Tap R$ (top right) to enter Fiat Mode on this Arkade wallet.",
        "short": "Tap R$",
        "target": "fiat",
    },
]

# Variants: (board_prefix, family, variant_label, style_key, note_title, note_body)
VARIANTS = [
    (
        "A1",
        "A Coachmarks",
        "Numbered bubbles + light dim",
        "coach_dim",
        "A1 Coachmarks · dim",
        "Numbered callout bubbles with a soft full-screen dim.\n\n"
        "Footer: Skip · Next / Done. Progress as step n/5.\n\n"
        "Best when you want clear reading order without a hard spotlight hole.",
    ),
    (
        "A2",
        "A Coachmarks",
        "Bubbles, no dim",
        "coach_clear",
        "A2 Coachmarks · clear",
        "Same numbered bubbles, no scrim — Home stays fully readable.\n\n"
        "Pointer line from badge to target. Footer Skip · Next.\n\n"
        "Lighter feel; risk of competing with chrome.",
    ),
    (
        "A3",
        "A Coachmarks",
        "Large card callouts",
        "coach_card",
        "A3 Coachmarks · cards",
        "Bigger mid-screen cards with step number + title + body.\n\n"
        "Thin connector to the target. More copy room; fewer frames feel busy.",
    ),
    (
        "B1",
        "B Spotlight",
        "Classic cutout + card",
        "spot_classic",
        "B1 Spotlight · classic",
        "Dark scrim with a rectangular cutout around the target.\n\n"
        "Tooltip card below/above the hole. Next / Skip / Done.\n\n"
        "Strong focus; standard product-tour pattern.",
    ),
    (
        "B2",
        "B Spotlight",
        "Cutout + gesture hint",
        "spot_gesture",
        "B2 Spotlight · gesture",
        "Same cutout language, plus swipe chevrons for POS / QR steps.\n\n"
        "Gesture steps show direction arrows inside the hole.\n\n"
        "Preferred when teaching Home edge swipes.",
    ),
    (
        "B3",
        "B Spotlight",
        "Ring + minimal tip",
        "spot_ring",
        "B3 Spotlight · ring",
        "Full dim with an outlined ring (no hard rect hole).\n\n"
        "Compact tip card. Quieter than B1; still blocks mis-taps via dim.",
    ),
    (
        "C1",
        "C Tooltip",
        "Anchored tip + dots",
        "tip_dots",
        "C1 Tooltip · dots",
        "No full spotlight. Tip anchored near the target.\n\n"
        "Progress dots under the tip. Skip in the corner.\n\n"
        "Least intrusive; good if Home must stay usable.",
    ),
    (
        "C2",
        "C Tooltip",
        "Compact + footer nav",
        "tip_footer",
        "C2 Tooltip · footer",
        "Small tip near target; persistent bottom bar Skip · Next.\n\n"
        "Dots centered above the bar. Familiar mobile-tour chrome.",
    ),
    (
        "C3",
        "C Tooltip",
        "Minimal floating",
        "tip_min",
        "C3 Tooltip · minimal",
        "One-line tip + n/5 only. No dim, no big cards.\n\n"
        "Tap target / Next to advance. Highest risk of being missed.",
    ),
]

SCENE_NOTES = {v[0]: (v[4], v[5]) for v in VARIANTS}

RULE_NOTE = (
    "Tour trigger rule",
    "Show this coach only after a fresh install and the first wallet is created, "
    "then land on Home.\n\n"
    "Do NOT show after Reset app unless that reset cleared the install (true fresh).\n\n"
    "Five highlights: POS swipe · QR swipe · Settings · Add Wallet · Fiat mode.",
)


def uid():
    return str(uuid.uuid4())


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def post(self, path, data):
        req = urllib.request.Request(
            BASE + path,
            data=json.dumps(data).encode(),
            headers={"content-type": "application/json", "accept": "application/json"},
            method="POST",
        )
        try:
            with self.opener.open(req) as r:
                raw = r.read()
                return r.status, (json.loads(raw.decode()) if raw else None)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()[:900]

    def get(self, path):
        req = urllib.request.Request(BASE + path, headers={"accept": "application/json"}, method="GET")
        with self.opener.open(req) as r:
            return json.loads(r.read().decode())

    def login(self):
        st, _ = self.post("/api/rpc/command/login-with-password", {"email": EMAIL, "password": PASSWORD})
        if st not in (200, 204):
            raise SystemExit(f"login {st}")

    def update(self, revn, vern, changes):
        return self.post(
            "/api/rpc/command/update-file",
            {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
        )


def push(c, revn, vern, changes, chunk=40):
    for i in range(0, len(changes), chunk):
        part = changes[i : i + chunk]
        st, out = c.update(revn, vern, part)
        if st != 200:
            raise SystemExit(f"fail @{i}: {out}")
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
    return revn, vern


def finish(changes, fr, kids, page_id):
    fr["shapes"] = [k["id"] for k in kids]
    changes.append(
        {"type": "add-obj", "id": fr["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": fr}
    )
    for k in kids:
        k["frame-id"] = fr["id"]
        k["parent-id"] = fr["id"]
        changes.append(
            {"type": "add-obj", "id": k["id"], "page-id": page_id, "frame-id": fr["id"], "parent-id": fr["id"], "obj": k}
        )


def note_height(body: str) -> int:
    lines = 0
    for block in body.split("\n"):
        lines += max(1, (len(block) // 42) + 1)
    return max(160, min(400, 54 + lines * 16))


def make_note(page_id: str, title: str, body: str, x: float, y: float, *, width: int = NOTE_W):
    h = note_height(body)
    fid = uid()
    frame = {
        "id": fid,
        "name": f"note · {title}",
        "type": "frame",
        "parent-id": ROOT,
        "frame-id": fid,
        "fills": [{"fill-color": "#FFE566", "fill-opacity": 1}],
        "strokes": [
            {
                "stroke-color": "#E6C200",
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": 1,
                "stroke-alignment": "inner",
            }
        ],
        "r1": 10,
        "r2": 10,
        "r3": 10,
        "r4": 10,
        "shapes": [],
        "show-content": True,
        "hide-fill-on-export": False,
        "hide-in-viewer": False,
    }
    rb.geom(frame, x, y, width, h)
    title_o = rb.make_text(
        "note-title", x + 14, y + 12, width - 28, 22, fid, fid, title, size=13, color="#1A1A1A", weight="700"
    )
    paragraphs = []
    for block in body.split("\n"):
        paragraphs.append(
            {
                "type": "paragraph",
                "text-align": "left",
                "children": [
                    {
                        "line-height": "1.35",
                        "font-style": "normal",
                        "text-align": "left",
                        "font-size": "11",
                        "font-weight": "400",
                        "font-family": "JetBrains Mono",
                        "font-id": "gfont-jetbrains-mono",
                        "font-variant": "normal",
                        "text-decoration": "none",
                        "text-transform": "none",
                        "fills": [{"fill-color": "#1A1A1A", "fill-opacity": 1}],
                        "text": block if block else " ",
                    }
                ],
            }
        )
    body_o = rb.shape("text", "note-body", x + 14, y + 40, width - 28, h - 54, fid, fid)
    body_o["grow-type"] = "fixed"
    body_o["content"] = {
        "type": "root",
        "vertical-align": "top",
        "children": [{"type": "paragraph-set", "children": paragraphs}],
    }
    frame["shapes"] = [title_o["id"], body_o["id"]]
    changes = [
        {"type": "add-obj", "id": frame["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame}
    ]
    for o in (title_o, body_o):
        changes.append(
            {"type": "add-obj", "id": o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": o}
        )
    return changes, h


def section_banner(page_id: str, title: str, x: float, y: float, w: float = 5 * COL - 40):
    """Dark monospace section label above a family of rows."""
    fid = uid()
    frame = {
        "id": fid,
        "name": f"section · {title}",
        "type": "frame",
        "parent-id": ROOT,
        "frame-id": fid,
        "fills": [{"fill-color": "#111111", "fill-opacity": 1}],
        "strokes": [
            {
                "stroke-color": "#FFFFFF",
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": 1.5,
                "stroke-alignment": "inner",
            }
        ],
        "r1": 8,
        "r2": 8,
        "r3": 8,
        "r4": 8,
        "shapes": [],
        "show-content": True,
        "hide-fill-on-export": False,
        "hide-in-viewer": False,
    }
    h = 48
    rb.geom(frame, x, y, w, h)
    label = rb.make_text(
        "sec-label", x + 16, y + 14, w - 32, 24, fid, fid, title, size=16, weight="700", color="#FFFFFF"
    )
    frame["shapes"] = [label["id"]]
    changes = [
        {"type": "add-obj", "id": fid, "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame},
        {"type": "add-obj", "id": label["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": label},
    ]
    return changes


# --- geometry helpers for tour targets --------------------------------------

def target_rect(ox, oy, target: str):
    """Return (x, y, w, h) of the highlight target in absolute coords."""
    if target == "gesture_ltr":
        # Left half of content — swipe start zone
        return ox + 20, oy + 200, 160, 280
    if target == "gesture_rtl":
        return ox + 210, oy + 200, 160, 280
    if target == "settings":
        # Empty header band (long-press) under status / beside logo
        return ox + 70, oy + 40, 250, 44
    if target == "avatar":
        return ox + 22, oy + 42, 32, 32
    if target == "fiat":
        return ox + 320, oy + 44, 44, 36
    return ox + 40, oy + 250, 310, 40


def tip_anchor(ox, oy, target: str, card_w=280, card_h=110):
    """Preferred tip card top-left so it doesn't cover the target."""
    tx, ty, tw, th = target_rect(ox, oy, target)
    if target in ("avatar", "settings", "fiat"):
        # below header chrome
        return ox + (PHONE_W - card_w) / 2, ty + th + 28, card_w, card_h
    if target == "gesture_ltr":
        return ox + 90, oy + 520, card_w, card_h
    if target == "gesture_rtl":
        return ox + 20, oy + 520, card_w, card_h
    return ox + (PHONE_W - card_w) / 2, oy + 520, card_w, card_h


# --- Home chrome ------------------------------------------------------------

def home_chrome(ox, oy, fid, kids, *, highlight_fiat=False):
    """Mock Basic Home: avatar, logo, R$ fiat, balance, Receive/Send, rates."""
    kids += rb.avatar(ox + 38, oy + 58, 11, fid, fid)
    kids += rb.logo(ox + 145, oy + 70, fid, fid, 1.0)
    # Fiat mode affordance (header right)
    kids.append(
        rb.make_rect(
            "fiat-btn",
            ox + 324,
            oy + 48,
            40,
            28,
            fid,
            fid,
            fill="#0D0D0D",
            stroke="#FFFFFF" if highlight_fiat else "#555555",
            sw=1.5,
            rx=8,
        )
    )
    kids.append(
        rb.make_text(
            "fiat-lbl",
            ox + 324,
            oy + 54,
            40,
            18,
            fid,
            fid,
            "R$",
            size=13,
            weight="700",
            align="center",
            color="#FFFFFF",
        )
    )
    kids.append(
        rb.make_text(
            "balance",
            ox + 40,
            oy + 250,
            310,
            40,
            fid,
            fid,
            "1,234,567 sats",
            size=28,
            weight="700",
            align="center",
        )
    )
    kids.append(
        rb.make_text(
            "fiat-line",
            ox + 40,
            oy + 292,
            310,
            24,
            fid,
            fid,
            "EUR 6,019 / USD 6,492",
            size=13,
            color=MUTED,
            align="center",
        )
    )
    kids.append(rb.make_rect("btn-receive", ox + 36, oy + 360, 140, 56, fid, fid, rx=10))
    kids.append(
        rb.make_text("label-receive", ox + 36, oy + 376, 140, 24, fid, fid, "Receive", size=16, align="center")
    )
    kids.append(rb.swap_arrows(ox + 195, oy + 388, fid, fid))
    kids.append(rb.make_rect("btn-send", ox + 214, oy + 360, 140, 56, fid, fid, rx=10))
    kids.append(
        rb.make_text("label-send", ox + 214, oy + 376, 140, 24, fid, fid, "Send", size=16, align="center")
    )
    cmds = rb.line(ox + 185, oy + 729, ox + 195, oy + 721) + rb.line(ox + 195, oy + 721, ox + 205, oy + 729)
    kids.append(rb.make_path("hist-chevron", fid, fid, cmds, sw=1.8))
    kids.append(
        rb.make_text(
            "hist-hint",
            ox + 40,
            oy + 740,
            310,
            18,
            fid,
            fid,
            "swipe up for activity",
            size=12,
            color=MUTED,
            align="center",
        )
    )
    kids.append(rb.rates(ox, oy, fid, fid))


def dim_full(ox, oy, fid, kids, opacity=0.45):
    r = rb.make_rect("dim", ox, oy, PHONE_W, PHONE_H, fid, fid, fill=DIM, stroke=None, rx=28)
    r["opacity"] = opacity
    kids.append(r)


def scrim_with_hole(ox, oy, fid, kids, hx, hy, hw, hh, opacity=0.72):
    """Approximate a spotlight hole with four dim rects around the target."""
    # clamp hole inside phone
    hx = max(ox + 4, hx)
    hy = max(oy + 4, hy)
    hw = min(hw, ox + PHONE_W - 4 - hx)
    hh = min(hh, oy + PHONE_H - 4 - hy)
    pieces = [
        ("scrim-top", ox, oy, PHONE_W, hy - oy),
        ("scrim-left", ox, hy, hx - ox, hh),
        ("scrim-right", hx + hw, hy, ox + PHONE_W - (hx + hw), hh),
        ("scrim-bot", ox, hy + hh, PHONE_W, oy + PHONE_H - (hy + hh)),
    ]
    for name, x, y, w, h in pieces:
        if w <= 0 or h <= 0:
            continue
        r = rb.make_rect(name, x, y, w, h, fid, fid, fill=DIM, stroke=None, rx=0)
        r["opacity"] = opacity
        kids.append(r)
    # outline around hole
    kids.append(
        rb.make_rect("hole-ring", hx - 2, hy - 2, hw + 4, hh + 4, fid, fid, fill=None, stroke="#FFFFFF", sw=2, rx=10)
    )


def badge(ox, oy, fid, kids, n, x, y, size=28):
    kids.append(rb.make_rect(f"badge-{n}", x, y, size, size, fid, fid, fill="#FFFFFF", stroke=None, rx=size / 2))
    kids.append(
        rb.make_text(
            f"badge-n-{n}",
            x,
            y + 6,
            size,
            18,
            fid,
            fid,
            str(n),
            size=13,
            weight="700",
            color="#000000",
            align="center",
        )
    )


def progress_dots(ox, oy, fid, kids, step_n, y=None, *, total=5):
    y = y if y is not None else oy + 690
    gap, d = 12, 8
    total_w = total * d + (total - 1) * gap
    start = ox + (PHONE_W - total_w) / 2
    for i in range(total):
        filled = i < step_n
        kids.append(
            rb.make_rect(
                f"dot-{i}",
                start + i * (d + gap),
                y,
                d,
                d,
                fid,
                fid,
                fill="#FFFFFF" if filled else "#333333",
                stroke=None,
                rx=d / 2,
            )
        )


def footer_nav(ox, oy, fid, kids, step_n, *, y=None, show_done=False):
    y = y if y is not None else oy + 760
    kids.append(
        rb.make_text("skip", ox + 28, y, 80, 20, fid, fid, "Skip", size=13, color=CAPTION)
    )
    label = "Done" if (show_done or step_n >= 5) else "Next"
    kids.append(
        rb.make_text("next", ox + 250, y, 110, 20, fid, fid, label, size=13, weight="700", align="right")
    )
    kids.append(
        rb.make_text(
            "prog",
            ox + 120,
            y,
            150,
            20,
            fid,
            fid,
            f"{step_n} / 5",
            size=12,
            color=MUTED,
            align="center",
        )
    )


def gesture_arrows(ox, oy, fid, kids, target: str):
    """LTR / RTL swipe chevrons inside gesture highlight zones."""
    tx, ty, tw, th = target_rect(ox, oy, target)
    cy = ty + th / 2
    if target == "gesture_ltr":
        # arrows pointing right
        for i, dx in enumerate((20, 50, 80)):
            x0 = tx + dx
            cmds = rb.line(x0, cy - 12, x0 + 18, cy) + rb.line(x0 + 18, cy, x0, cy + 12)
            kids.append(rb.make_path(f"arr-r-{i}", fid, fid, cmds, sw=2.2, stroke="#FFFFFF"))
        kids.append(
            rb.make_text(
                "g-hint",
                tx,
                ty + th - 36,
                tw,
                20,
                fid,
                fid,
                "swipe →",
                size=12,
                color="#FFFFFF",
                align="center",
            )
        )
    elif target == "gesture_rtl":
        for i, dx in enumerate((20, 50, 80)):
            x0 = tx + tw - dx
            cmds = rb.line(x0, cy - 12, x0 - 18, cy) + rb.line(x0 - 18, cy, x0, cy + 12)
            kids.append(rb.make_path(f"arr-l-{i}", fid, fid, cmds, sw=2.2, stroke="#FFFFFF"))
        kids.append(
            rb.make_text(
                "g-hint",
                tx,
                ty + th - 36,
                tw,
                20,
                fid,
                fid,
                "← swipe",
                size=12,
                color="#FFFFFF",
                align="center",
            )
        )


def connector(fid, kids, x1, y1, x2, y2):
    cmds = rb.line(x1, y1, x2, y2)
    kids.append(rb.make_path("conn", fid, fid, cmds, sw=1.4, stroke="#FFFFFF"))


def bubble_card(ox, oy, fid, kids, step, x, y, w, h, *, numbered=True):
    kids.append(rb.make_rect("bubble", x, y, w, h, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=12))
    if numbered:
        badge(ox, oy, fid, kids, step["n"], x + 12, y + 12, size=26)
        title_x = x + 48
    else:
        title_x = x + 14
    kids.append(
        rb.make_text(
            "btitle",
            title_x,
            y + 14,
            w - (title_x - x) - 12,
            20,
            fid,
            fid,
            step["title"],
            size=14,
            weight="700",
        )
    )
    kids.append(
        rb.make_text(
            "bbody",
            x + 14,
            y + 44,
            w - 28,
            h - 56,
            fid,
            fid,
            step["body"],
            size=11,
            color=CAPTION,
        )
    )


# --- style builders ---------------------------------------------------------

def build_step_frame(name: str, ox: float, oy: float, step: dict, style: str):
    fr = rb.make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    home_chrome(ox, oy, fid, kids, highlight_fiat=(step["target"] == "fiat"))
    tx, ty, tw, th = target_rect(ox, oy, step["target"])
    n = step["n"]

    if style == "coach_dim":
        dim_full(ox, oy, fid, kids, 0.4)
        # re-draw a faint ring on target so it peeks through dim intent
        kids.append(rb.make_rect("tgt", tx, ty, tw, th, fid, fid, fill=None, stroke="#FFFFFF", sw=2, rx=10))
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 300, 120)
        bubble_card(ox, oy, fid, kids, step, bx, by, bw, bh)
        # connector from badge area to target center
        connector(fid, kids, bx + 25, by, tx + tw / 2, ty + th)
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])
        footer_nav(ox, oy, fid, kids, n)

    elif style == "coach_clear":
        kids.append(rb.make_rect("tgt", tx - 4, ty - 4, tw + 8, th + 8, fid, fid, fill=None, stroke="#FFFFFF", sw=2, rx=12))
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 290, 115)
        bubble_card(ox, oy, fid, kids, step, bx, by, bw, bh)
        connector(fid, kids, bx + 24, by + 20, tx + tw / 2, ty + th / 2)
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])
        footer_nav(ox, oy, fid, kids, n)

    elif style == "coach_card":
        dim_full(ox, oy, fid, kids, 0.28)
        kids.append(rb.make_rect("tgt", tx, ty, tw, th, fid, fid, fill=None, stroke="#FFFFFF", sw=2, rx=10))
        cx = ox + 40
        cy = oy + 430
        kids.append(rb.make_rect("card", cx, cy, 310, 160, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", sw=1.5, rx=14))
        badge(ox, oy, fid, kids, n, cx + 16, cy + 16, size=32)
        kids.append(
            rb.make_text("ct", cx + 60, cy + 22, 220, 24, fid, fid, step["title"], size=16, weight="700")
        )
        kids.append(
            rb.make_text("cb", cx + 16, cy + 60, 278, 70, fid, fid, step["body"], size=12, color=CAPTION)
        )
        kids.append(
            rb.make_text("cs", cx + 16, cy + 132, 278, 18, fid, fid, step["short"], size=11, color=MUTED)
        )
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])
        footer_nav(ox, oy, fid, kids, n, y=oy + 780)

    elif style == "spot_classic":
        scrim_with_hole(ox, oy, fid, kids, tx - 6, ty - 6, tw + 12, th + 12)
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 300, 100)
        # keep tip in dark area below hole when possible
        if by < ty + th:
            by = ty + th + 24
        bubble_card(ox, oy, fid, kids, step, bx, by, bw, bh, numbered=True)
        footer_nav(ox, oy, fid, kids, n)

    elif style == "spot_gesture":
        scrim_with_hole(ox, oy, fid, kids, tx - 6, ty - 6, tw + 12, th + 12, opacity=0.78)
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])
        else:
            # small pulse ring for tap targets
            kids.append(
                rb.make_rect(
                    "pulse",
                    tx - 10,
                    ty - 10,
                    tw + 20,
                    th + 20,
                    fid,
                    fid,
                    fill=None,
                    stroke="#FFFFFF",
                    sw=1,
                    rx=14,
                )
            )
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 300, 100)
        if by < ty + th + 8:
            by = min(oy + 560, ty + th + 28)
        bubble_card(ox, oy, fid, kids, step, bx, by, bw, bh)
        footer_nav(ox, oy, fid, kids, n)

    elif style == "spot_ring":
        dim_full(ox, oy, fid, kids, 0.7)
        # ring only
        pad = 14
        kids.append(
            rb.make_rect(
                "ring",
                tx - pad,
                ty - pad,
                tw + 2 * pad,
                th + 2 * pad,
                fid,
                fid,
                fill=None,
                stroke="#FFFFFF",
                sw=2.5,
                rx=16,
            )
        )
        # soft inner clear hint (lighter rect to suggest focus)
        kids.append(
            rb.make_rect("inner", tx, ty, tw, th, fid, fid, fill="#1A1A1A", stroke=None, rx=8)
        )
        kids[-1]["opacity"] = 0.35
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 280, 90)
        kids.append(rb.make_rect("tip", bx, by, bw, bh, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=10))
        kids.append(
            rb.make_text("tt", bx + 14, by + 12, bw - 28, 20, fid, fid, f"{n}. {step['title']}", size=13, weight="700")
        )
        kids.append(
            rb.make_text("tb", bx + 14, by + 40, bw - 28, 40, fid, fid, step["short"], size=12, color=CAPTION)
        )
        footer_nav(ox, oy, fid, kids, n)

    elif style == "tip_dots":
        kids.append(rb.make_rect("tgt", tx - 3, ty - 3, tw + 6, th + 6, fid, fid, fill=None, stroke="#FFFFFF", sw=1.5, rx=10))
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 260, 88)
        kids.append(rb.make_rect("tip", bx, by, bw, bh, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=10))
        kids.append(
            rb.make_text("tt", bx + 12, by + 10, bw - 24, 18, fid, fid, step["title"], size=13, weight="700")
        )
        kids.append(
            rb.make_text("tb", bx + 12, by + 34, bw - 24, 36, fid, fid, step["short"], size=11, color=CAPTION)
        )
        progress_dots(ox, oy, fid, kids, n, y=by + bh + 14)
        kids.append(
            rb.make_text("skip", ox + 28, oy + 780, 80, 18, fid, fid, "Skip", size=12, color=CAPTION)
        )
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])

    elif style == "tip_footer":
        kids.append(rb.make_rect("tgt", tx - 3, ty - 3, tw + 6, th + 6, fid, fid, fill=None, stroke="#FFFFFF", sw=1.5, rx=10))
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 250, 72)
        kids.append(rb.make_rect("tip", bx, by, bw, bh, fid, fid, fill="#0D0D0D", stroke="#333333", sw=1.5, rx=8))
        kids.append(
            rb.make_text("tt", bx + 12, by + 12, bw - 24, 18, fid, fid, step["title"], size=13, weight="700")
        )
        kids.append(
            rb.make_text("tb", bx + 12, by + 38, bw - 24, 24, fid, fid, step["short"], size=11, color=CAPTION)
        )
        # footer bar
        kids.append(
            rb.make_rect("fbar", ox, oy + 780, PHONE_W, 64, fid, fid, fill="#0A0A0A", stroke="#222222", sw=1, rx=0)
        )
        progress_dots(ox, oy, fid, kids, n, y=oy + 792)
        footer_nav(ox, oy, fid, kids, n, y=oy + 812)
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])

    elif style == "tip_min":
        kids.append(rb.make_rect("tgt", tx - 2, ty - 2, tw + 4, th + 4, fid, fid, fill=None, stroke="#FFFFFF", sw=1.2, rx=8))
        bx, by, bw, bh = tip_anchor(ox, oy, step["target"], 220, 48)
        kids.append(rb.make_rect("tip", bx, by, bw, bh, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1, rx=8))
        kids.append(
            rb.make_text(
                "tt",
                bx + 10,
                by + 14,
                bw - 20,
                22,
                fid,
                fid,
                f"{step['short']}  ·  {n}/5",
                size=12,
                weight="700",
                align="center",
            )
        )
        if step["target"].startswith("gesture"):
            gesture_arrows(ox, oy, fid, kids, step["target"])

    else:
        raise SystemExit(f"unknown style {style}")

    return fr, kids


def layout_variant_row(variant_index: int):
    """Map variant index 0..8 to (row_y_offset_index, section)."""
    # Groups: A 0-2, B 3-5, C 6-8 — each family starts after a banner gap
    return variant_index


def board_origin(variant_i: int, step_i: int):
    # Extra vertical gap between families (after A and after B)
    family = variant_i // 3
    within = variant_i % 3
    # banner (~70) + note (~220) + phones per variant row
    family_base = family * (3 * ROW + 160)
    row_y = ORIGIN_Y + family_base + within * ROW
    col_x = ORIGIN_X + step_i * COL
    return col_x, row_y


def ensure_page(c, revn, vern, pages):
    if PAGE_NAME in pages:
        return pages, revn, vern, pages[PAGE_NAME]
    pid = str(uuid.uuid4())
    st, out = c.update(revn, vern, [{"type": "add-page", "id": pid, "name": PAGE_NAME}])
    if st != 200:
        raise SystemExit(f"add-page failed: {out}")
    revn, vern = int(out["revn"]), int(out.get("vern", vern))
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    pages = {meta["data"]["pagesIndex"][p]["name"]: p for p in meta["data"]["pages"]}
    print(f"created page {PAGE_NAME} -> {pages[PAGE_NAME]}")
    return pages, revn, vern, pages[PAGE_NAME]


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][p]["name"]: p for p in meta["data"]["pages"]}
    print("existing pages:", sorted(pages.keys()))
    pages, revn, vern, page_id = ensure_page(c, revn, vern, pages)

    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])

    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") != "Root Frame"
    ]
    print(f"wipe {PAGE_NAME}: {len(wipe)} objs")
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    boards: dict[str, tuple[dict, list]] = {}
    board_order: list[str] = []

    for vi, (prefix, family, vlabel, style, _nt, _nb) in enumerate(VARIANTS):
        for si, step in enumerate(STEPS):
            name = f"{prefix} · {step['n']} {step['title']}"
            ox, oy = board_origin(vi, si)
            fr, kids = build_step_frame(name, ox, oy, step, style)
            boards[name] = (fr, kids)
            board_order.append(name)
            print(f"  build {name} @ ({ox},{oy}) kids={len(kids)}")

    changes = []

    # Section banners
    for family_i, title in enumerate(
        [
            "A — Coachmarks (numbered callouts)",
            "B — Spotlight Overlay (scrim + cutout)",
            "C — Tooltip Tour (anchored, no full spotlight)",
        ]
    ):
        # place banner just above first variant of family
        _, first_y = board_origin(family_i * 3, 0)
        banner_y = first_y - 300
        changes.extend(section_banner(page_id, title, ORIGIN_X, banner_y))

    # Rule note top-left
    rule_changes, rule_h = make_note(page_id, RULE_NOTE[0], RULE_NOTE[1], ORIGIN_X, 40, width=520)
    changes.extend(rule_changes)

    # Push boards (reverse for z-order like other scripts)
    for name in reversed(board_order):
        fr, kids = boards[name]
        finish(changes, fr, kids, page_id)

    # Yellow notes: one per variant, above step-1 of that row
    for vi, (prefix, _fam, _vl, _st, ntitle, nbody) in enumerate(VARIANTS):
        ox, oy = board_origin(vi, 0)
        nh = note_height(nbody)
        note_y = oy - nh - 24
        note_changes, _ = make_note(page_id, ntitle, nbody, ox, note_y)
        changes.extend(note_changes)

    print(f"pushing {len(changes)} changes")
    revn, vern = push(c, revn, vern, changes, chunk=35)
    team = re.search(r"PENPOT_TEAM_ID=(.*)", ENV).group(1).strip()
    url = f"{BASE}/#/workspace/{team}/{FILE}?page-id={page_id}"
    print(f"done revn={revn} vern={vern}")
    print(f"page={PAGE_NAME} id={page_id}")
    print(f"boards={len(board_order)}")
    print(f"url={url}")
    for name in board_order:
        print(f"BOARD\t{name}")


if __name__ == "__main__":
    main()
