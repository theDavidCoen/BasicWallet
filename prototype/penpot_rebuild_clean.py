#!/usr/bin/env python3
"""Wipe Basic Wallet Penpot page and rebuild all boards in a clean flow grid.

Penpot JSON API cannot update selrect (must be a Rect record). Moving via x/y
only desyncs the canvas. Fix: delete + re-add so geometry is created correctly.
"""
from __future__ import annotations

import json
import math
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path
import importlib.util

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
PAGE = "0d808482-264d-8195-8008-a46d9fbf8811"
ROOT = "00000000-0000-0000-0000-000000000000"
BASE = "http://192.168.1.104:9001"
ENV = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
EMAIL = re.search(r"PENPOT_EMAIL=(.*)", ENV).group(1).strip()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", ENV).group(1).strip()

_spec = importlib.util.spec_from_file_location("vl", Path(__file__).with_name("penpot_vector_logo.py"))
_vl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vl)

PHONE_W, PHONE_H = 390, 844
COL, ROW = 460, 1004
ORIGIN_X, ORIGIN_Y = 40, 160
# Muted captions: slightly lighter than field labels (#8C8C8C)
CAPTION = "#B3B3B3"
HINT = "#999999"

LAYOUT = [
    ("00 · Onboarding", [
        "11 Onboarding Create",
        "11b Terms of Use (passkey)",
        "11b2 Terms of Use (device only)",
        "11c Passkey not found",
        "11d Ready",
        "12 Advanced Backup",
        "12d Nostr backup",
        "12e Home server backup",
        "12f Import nsec warning",
        "12b Restore seed",
        "12c Restore nsec",
        "12h Restore home server",
    ]),
    ("10 · Add wallet", [
        "14 Add wallet",
        "14b Create without passkey",
        "14c Name new wallet",
    ]),
    ("01 · Home", [
        "01 Home",
        "01b Home privacy",
        "01c Wallet switcher",
        "01j Edit wallet",
        "01k Remove wallet warning",
        "01m Remove Lightning warning",
        "01d Activity sheet",
        "01h Transaction details",
        "01i Transaction details LN",
        "01e Lock biometrics",
        "01f Lock PIN",
        "01g Duress Home",
    ]),
    ("02 · Receive", ["02 Receive BIP21", "02d Receive POS", "02b Receive sheet", "02c Receive share sheet"]),
    ("03 · Send", [
        "03 Send empty",
        "03b Send ready",
        "03c Send slide early",
        "03d Send slide mid",
        "03e Send success",
        "03f Scan QR",
    ]),
    ("04 · Swap", ["04 Swap BTC to USDT", "04b Swap success"]),
    ("05 · Node", [
        "06 Connect Node",
        "06b Connect BTCPay",
        "06c Connect NWC",
        "06d Connect Manual LND",
        "13 Node Status",
    ]),
    ("06 · Settings", [
        "05 Settings",
        "05as Arkade Settings",
        "05b Display currencies",
        "05c Privacy",
        "05d Nostr identity",
        "05i Export nsec warning",
        "05j Export nsec reveal",
        "05k Generate identity warning",
        "05e Backup",
        "05f About",
        "05g Duress PIN",
        "05h Passkey status",
        "11e Export recovery phrase",
        "07 Hardware Wallet",
        "07b Pair hardware",
        "07c Confirm on device",
    ]),
    ("07 · Contacts", [
        "08 Contacts",
        "08d Contacts search",
        "08b Choose Recipient",
        "08c Edit contact",
        "08e Add contact",
    ]),
    ("08 · Nostr", [
        "09 Nostr inbox",
        "09b Compose request",
        "09c Incoming pay",
        "09d Outgoing pending",
        "09e Accepted address",
        "09f Declined / expired",
    ]),
    ("09 · Multisig", [
        "10 Multisig",
        "10b Multisig invite",
        "10c Multisig pending",
        "10d Multisig cosign",
        "10e Create vault",
        "10f Import descriptor",
    ]),
]


def mid_ellipsis(s: str, head: int = 8, tail: int = 6) -> str:
    """Show start + end of addresses / invoices so users can verify both ends."""
    if len(s) <= head + tail + 1:
        return s
    return f"{s[:head]}…{s[-tail:]}"


# Canonical demo identifiers (full) — display via mid_ellipsis
DEMO_BC1 = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
DEMO_TAPROOT = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ca74me5kvjzeqs0tj8z"
DEMO_ARK = "ark1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
DEMO_BIP21 = f"bitcoin:{DEMO_BC1}"
DEMO_LN = "lnbc250u1p3xy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
DEMO_NPUB_ALICE = "npub1alicexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
DEMO_NPUB_BOB = "npub1bobyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
DEMO_NPUB_YOU = "npub1youzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
DEMO_NPUB_BASIC = "npub1basicxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
DEMO_NSEC = "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
DEMO_LNURL = "lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvc9jcucnvwpwxf3x2escxg6rgv"


def uid():
    return str(uuid.uuid4())


def matrix():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def selrect(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def points(x, y, w, h):
    return [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]


def geom(o, x, y, w, h):
    o.update(
        {
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "selrect": selrect(x, y, w, h),
            "points": points(x, y, w, h),
            "transform": matrix(),
            "transform-inverse": matrix(),
            "rotation": 0,
            "opacity": o.get("opacity", 1),
        }
    )
    return o


def shape(typ, name, x, y, w, h, parent, frame):
    return geom(
        {"id": uid(), "name": name, "type": typ, "parent-id": parent, "frame-id": frame, "fills": [], "strokes": []},
        x,
        y,
        w,
        h,
    )


def make_frame(name, x, y):
    fid = uid()
    o = shape("frame", name, x, y, PHONE_W, PHONE_H, ROOT, fid)
    o["id"] = fid
    o["frame-id"] = fid
    o["fills"] = [{"fill-color": "#000000", "fill-opacity": 1}]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = 28
    o["shapes"] = []
    o["hide-fill-on-export"] = False
    o["show-content"] = True
    o["hide-in-viewer"] = False
    return o


def make_rect(name, x, y, w, h, parent, frame, *, fill=None, stroke="#FFFFFF", sw=1.5, rx=8):
    o = shape("rect", name, x, y, w, h, parent, frame)
    if fill:
        o["fills"] = [{"fill-color": fill, "fill-opacity": 1}]
    if stroke:
        o["strokes"] = [
            {
                "stroke-color": stroke,
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": sw,
                "stroke-alignment": "inner",
            }
        ]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = rx
    return o


def make_text(name, x, y, w, h, parent, frame, text, *, size=14, color="#FFFFFF", weight="400", align="left"):
    o = shape("text", name, x, y, w, h, parent, frame)
    o["grow-type"] = "fixed"
    o["content"] = {
        "type": "root",
        "vertical-align": "top",
        "children": [
            {
                "type": "paragraph-set",
                "children": [
                    {
                        "type": "paragraph",
                        "text-align": align,
                        "children": [
                            {
                                "line-height": "1.2",
                                "font-style": "normal",
                                "text-align": align,
                                "font-size": str(size),
                                "font-weight": str(weight),
                                "font-family": "JetBrains Mono",
                                "font-id": "gfont-jetbrains-mono",
                                "font-variant": "normal",
                                "text-decoration": "none",
                                "text-transform": "none",
                                "fills": [{"fill-color": color, "fill-opacity": 1}],
                                "text": text,
                            }
                        ],
                    }
                ],
            }
        ],
    }
    return o


def make_path(name, parent, frame, cmds, *, stroke="#FFFFFF", sw=1.5, fill=None):
    xs, ys = [], []
    for c in cmds:
        for k, v in (c.get("params") or {}).items():
            if k.endswith("x") or k == "x":
                xs.append(v)
            elif k.endswith("y") or k == "y":
                ys.append(v)
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    pad = sw + 1
    o = shape("path", name, x0 - pad, y0 - pad, (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad, parent, frame)
    o["content"] = cmds
    o["fills"] = [{"fill-color": fill, "fill-opacity": 1}] if fill else []
    if stroke:
        o["strokes"] = [
            {
                "stroke-color": stroke,
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": sw,
                "stroke-alignment": "center",
            }
        ]
    else:
        o["strokes"] = []
    return o


def line(x1, y1, x2, y2):
    return [
        {"command": "move-to", "params": {"x": x1, "y": y1}},
        {"command": "line-to", "params": {"x": x2, "y": y2}},
    ]


def circle(cx, cy, r, n=18):
    cmds = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n - math.pi / 2
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        cmds.append({"command": "move-to" if i == 0 else "line-to", "params": {"x": x, "y": y}})
    cmds.append({"command": "close-path", "params": {}})
    return cmds


def logo(ox, oy, parent, frame, scale=0.77):
    return _vl.make_logo_group(ox, oy, parent, frame, scale=scale)


def swap_arrows(cx, cy, parent, frame):
    cmds = []
    cmds += line(cx - 5, cy + 8, cx - 5, cy - 8)
    cmds += line(cx - 5, cy - 8, cx - 8, cy - 4)
    cmds += line(cx - 5, cy - 8, cx - 2, cy - 4)
    cmds += line(cx + 5, cy - 8, cx + 5, cy + 8)
    cmds += line(cx + 5, cy + 8, cx + 2, cy + 4)
    cmds += line(cx + 5, cy + 8, cx + 8, cy + 4)
    return make_path("swap-ico", parent, frame, cmds, sw=1.6)


def camera_lens(cx, cy, parent, frame):
    cmds = circle(cx, cy, 28, 28) + circle(cx, cy, 20, 24) + circle(cx, cy, 10, 20) + line(cx - 6, cy - 14, cx + 2, cy - 18)
    return make_path("scan-lens", parent, frame, cmds, sw=1.7)


def icon_copy(cx, cy, parent, frame):
    cmds = (
        line(cx - 6, cy - 4, cx + 4, cy - 4)
        + line(cx + 4, cy - 4, cx + 4, cy + 8)
        + line(cx + 4, cy + 8, cx - 6, cy + 8)
        + line(cx - 6, cy + 8, cx - 6, cy - 4)
        + line(cx - 2, cy - 8, cx + 8, cy - 8)
        + line(cx + 8, cy - 8, cx + 8, cy + 4)
        + line(cx + 8, cy + 4, cx + 4, cy + 4)
        + line(cx - 2, cy - 8, cx - 2, cy - 4)
    )
    return make_path("ico-copy", parent, frame, cmds, sw=1.5)


def icon_share(cx, cy, parent, frame):
    nodes = [(cx, cy - 8), (cx - 8, cy + 6), (cx + 8, cy + 6)]
    cmds = []
    for x, y in nodes:
        cmds += circle(x, y, 2.5, 10)
    cmds += line(nodes[0][0], nodes[0][1], nodes[1][0], nodes[1][1])
    cmds += line(nodes[0][0], nodes[0][1], nodes[2][0], nodes[2][1])
    return make_path("ico-share", parent, frame, cmds, sw=1.5)


def avatar(cx, cy, r, parent, frame):
    """Wallet switcher affordance: empty circle + plus (not a face)."""
    kids = []
    kids.append(
        make_rect("avatar-ring", cx - r, cy - r, 2 * r, 2 * r, parent, frame, fill="#000000", stroke="#FFFFFF", sw=1.5, rx=r)
    )
    arm = max(4, r * 0.45)
    cmds = []
    cmds += line(cx - arm, cy, cx + arm, cy)
    cmds += line(cx, cy - arm, cx, cy + arm)
    kids.append(make_path("avatar-plus", parent, frame, cmds, sw=1.6))
    return kids


def fake_qr(x, y, parent, frame, n=13, cell=10):
    kids = [make_rect("qr-bg", x, y, n * cell, n * cell, parent, frame, fill="#FFFFFF", stroke=None, rx=4)]
    # deterministic pattern
    for i in range(n):
        for j in range(n):
            if (i * 7 + j * 3) % 5 == 0 or (i < 3 and j < 3) or (i < 3 and j >= n - 3) or (i >= n - 3 and j < 3):
                kids.append(
                    make_rect(
                        f"qr-{i}-{j}",
                        x + j * cell + 1,
                        y + i * cell + 1,
                        cell - 2,
                        cell - 2,
                        parent,
                        frame,
                        fill="#000000",
                        stroke=None,
                        rx=0,
                    )
                )
    return kids


def elastic_slider(ox, oy, parent, frame, *, progress, label="slide to confirm", label_color="#FFFFFF"):
    track_w, track_h = 334, 52
    fill_w = max(48, int(track_w * progress))
    kids = []
    kids.append(make_rect("slider", ox, oy, track_w, track_h, parent, frame, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=10))
    kids.append(make_rect("slider-elastic", ox + 4, oy + 4, fill_w - 8, track_h - 8, parent, frame, fill="#FFFFFF", stroke=None, rx=8))
    kids.append(make_text("slide", ox, oy + 16, track_w, 24, parent, frame, label, size=13, color=label_color, align="center"))
    kids.append(
        make_text(
            "handle-gt",
            ox + fill_w - 36,
            oy + 14,
            28,
            24,
            parent,
            frame,
            ">",
            size=16,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    return kids


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
            return e.code, e.read().decode()[:800]

    def get(self, path):
        req = urllib.request.Request(BASE + path, headers={"accept": "application/json"}, method="GET")
        with self.opener.open(req) as r:
            return json.loads(r.read().decode())

    def login(self):
        st, _ = self.post("/api/rpc/command/login-with-password", {"email": EMAIL, "password": PASSWORD})
        if st not in (200, 204):
            raise SystemExit(f"login failed {st}")

    def update(self, revn, vern, changes):
        return self.post(
            "/api/rpc/command/update-file",
            {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
        )


def push(c, revn, vern, changes, chunk=50):
    for i in range(0, len(changes), chunk):
        part = changes[i : i + chunk]
        st, out = c.update(revn, vern, part)
        if st != 200:
            raise SystemExit(f"update fail @{i}: {out}")
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
        print(f"  chunk {i}+{len(part)} -> revn {revn}")
    return revn, vern


def add(changes, obj, parent, frame):
    changes.append(
        {"type": "add-obj", "id": obj["id"], "page-id": PAGE, "frame-id": frame, "parent-id": parent, "obj": obj}
    )


def finish(changes, fr, kids):
    fr["shapes"] = [k["id"] for k in kids]
    add(changes, fr, ROOT, fr["id"])
    for k in kids:
        add(changes, k, fr["id"], fr["id"])


def rates(ox, oy, parent, frame):
    return make_text(
        "rates",
        ox + 28,
        oy + 800,
        334,
        18,
        parent,
        frame,
        "BTC/USD 64,920   ·   BTC/EUR 60,190",
        size=11,
        color="#8C8C8C",
        align="center",
    )


def build_home(ox, oy, privacy=False):
    fr = make_frame("01b Home privacy" if privacy else "01 Home", ox, oy)
    fid = fr["id"]
    kids = []
    kids += avatar(ox + 38, oy + 58, 11, fid, fid)
    kids += logo(ox + 145, oy + 70, fid, fid, 1.0)
    if privacy:
        kids.append(make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "****** sats", size=28, weight="700", align="center"))
        kids.append(make_text("fiat", ox + 40, oy + 292, 310, 24, fid, fid, "tap to show", size=13, color="#8C8C8C", align="center"))
    else:
        kids.append(make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "1,234,567 sats", size=28, weight="700", align="center"))
        kids.append(make_text("fiat", ox + 40, oy + 292, 310, 24, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center"))
    kids.append(make_rect("btn-receive", ox + 36, oy + 360, 140, 56, fid, fid, rx=10))
    kids.append(make_text("label-receive", ox + 36, oy + 376, 140, 24, fid, fid, "Receive", size=16, align="center"))
    kids.append(swap_arrows(ox + 195, oy + 388, fid, fid))
    kids.append(make_rect("btn-send", ox + 214, oy + 360, 140, 56, fid, fid, rx=10))
    kids.append(make_text("label-send", ox + 214, oy + 376, 140, 24, fid, fid, "Send", size=16, align="center"))
    kids.append(rates(ox, oy, fid, fid))
    # history hint
    cmds = line(ox + 185, oy + 729, ox + 195, oy + 721) + line(ox + 195, oy + 721, ox + 205, oy + 729)
    kids.append(make_path("hist-chevron", fid, fid, cmds, sw=1.8))
    kids.append(make_text("hist-hint", ox + 40, oy + 740, 310, 18, fid, fid, "swipe up for activity", size=12, color="#8C8C8C", align="center"))
    return fr, kids


def bottom_sheet_chrome(ox, oy, parent, frame, sheet_h=520):
    """Scrim + sheet from bottom + grabber. Returns (kids, sheet_top)."""
    kids = []
    kids.append(make_rect("scrim", ox, oy, PHONE_W, PHONE_H, parent, frame, fill="#000000", stroke=None, rx=28))
    kids[-1]["opacity"] = 0.55
    top = oy + PHONE_H - sheet_h
    kids.append(make_rect("sheet", ox, top, PHONE_W, sheet_h, parent, frame, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=20))
    kids.append(make_rect("grab", ox + 165, top + 12, 60, 5, parent, frame, fill="#555555", stroke=None, rx=2.5))
    return kids, top


def ghost_home_chrome(ox, oy, parent, frame):
    """Faint Home behind a bottom sheet (no interactive chrome)."""
    kids = []
    kids += avatar(ox + 38, oy + 58, 11, parent, frame)
    kids += logo(ox + 145, oy + 70, parent, frame, 1.0)
    kids.append(make_text("g-bal", ox + 40, oy + 250, 310, 40, parent, frame, "1,234,567 sats", size=28, weight="700", align="center", color="#333333"))
    kids.append(make_text("g-fiat", ox + 40, oy + 292, 310, 24, parent, frame, "EUR 6,019 / USD 6,492", size=13, color="#333333", align="center"))
    kids.append(make_rect("g-recv", ox + 36, oy + 360, 140, 56, parent, frame, fill=None, stroke="#333333", rx=10))
    kids.append(make_text("g-recv-l", ox + 36, oy + 376, 140, 24, parent, frame, "Receive", size=16, color="#333333", align="center"))
    kids.append(make_rect("g-send", ox + 214, oy + 360, 140, 56, parent, frame, fill=None, stroke="#333333", rx=10))
    kids.append(make_text("g-send-l", ox + 214, oy + 376, 140, 24, parent, frame, "Send", size=16, color="#333333", align="center"))
    return kids


def build_wallet_switcher(ox, oy):
    fr = make_frame("01c Wallet switcher", ox, oy)
    fid = fr["id"]
    kids = []
    kids += ghost_home_chrome(ox, oy, fid, fid)
    sheet_kids, top = bottom_sheet_chrome(ox, oy, fid, fid, sheet_h=620)
    kids += sheet_kids
    kids.append(make_text("st", ox + 28, top + 24, 334, 24, fid, fid, "Wallets", size=16, weight="700"))
    # Basic wallets + Lightning from connected node (separate balances)
    # Tag on LN row = connected node type (BTCPay | NWC | macaroon)
    wallets = [
        ("P", "Personal", "main", "1,234,567 sats", True),
        ("S", "Savings", "cold", "8,000,000 sats", False),
        ("T", "Travel", "ark", "250,000 sats", False),
        ("L", "Lightning", "BTCPay", "812,400 sats", False),
    ]
    for i, (letter, name, kind, bal, sel) in enumerate(wallets):
        yy = top + 60 + i * 80
        kids += person_row(ox + 28, yy, 334, letter, name, kind, bal, fid, fid, selected=sel, prefix=f"w{i}")
    kids.append(make_rect("add", ox + 28, top + 400, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("add-l", ox + 28, top + 414, 334, 24, fid, fid, "+ Create wallet", size=14, color="#000000", weight="700", align="center")
    )
    kids.append(make_rect("ln", ox + 28, top + 460, 334, 48, fid, fid, rx=10))
    kids.append(
        make_text("ln-l", ox + 28, top + 474, 334, 24, fid, fid, "Connect Lightning Node", size=14, align="center")
    )
    return fr, kids


def build_edit_wallet(ox, oy):
    """From switcher › — rename or remove. Example: Travel (seed wallet)."""
    fr = make_frame("01j Edit wallet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "EDIT WALLET", size=20, weight="700", align="center"))
    kids.append(make_text("sub", ox + 40, oy + 140, 310, 20, fid, fid, "Travel · ark", size=13, color=CAPTION, align="center"))
    kids.append(make_text("ln", ox + 28, oy + 200, 120, 18, fid, fid, "name", size=12, color="#8C8C8C"))
    kids.append(make_rect("fn", ox + 28, oy + 222, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vn", ox + 42, oy + 236, 300, 24, fid, fid, "Travel", size=16, weight="700"))
    kids.append(make_rect("save", ox + 28, oy + 300, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("savel", ox + 28, oy + 314, 334, 24, fid, fid, "Save name", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "rm",
            ox + 28,
            oy + 390,
            334,
            24,
            fid,
            fid,
            "Remove wallet",
            size=15,
            color="#E5484D",
            align="center",
        )
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 440,
            334,
            40,
            fid,
            fid,
            "Removing a seed wallet is permanent\nunless you backed up the phrase.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_remove_wallet_warning(ox, oy):
    """Confirm remove for seed/passkey wallets — offer backup first."""
    fr = make_frame("01k Remove wallet warning", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "REMOVE WALLET?", size=18, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 145,
            310,
            72,
            fid,
            fid,
            "Travel will be deleted from this device.\nWithout a backup you cannot recover funds.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_rect("card", ox + 28, oy + 240, 334, 120, fid, fid, fill="#141414", stroke="#333333", rx=12))
    kids.append(make_text("ct", ox + 44, oy + 260, 300, 22, fid, fid, "Recommended", size=13, weight="700"))
    kids.append(
        make_text(
            "cd",
            ox + 44,
            oy + 290,
            300,
            48,
            fid,
            fid,
            "Export the recovery phrase first,\nthen remove this wallet.",
            size=13,
            color=CAPTION,
        )
    )
    kids.append(make_rect("bak", ox + 28, oy + 390, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("bakl", ox + 28, oy + 404, 334, 24, fid, fid, "Backup recovery phrase", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "rm",
            ox + 28,
            oy + 470,
            334,
            24,
            fid,
            fid,
            "Remove without backup",
            size=15,
            color="#E5484D",
            align="center",
        )
    )
    kids.append(make_rect("cancel", ox + 28, oy + 530, 334, 48, fid, fid, rx=10))
    kids.append(make_text("cancell", ox + 28, oy + 544, 334, 24, fid, fid, "Cancel", size=15, align="center"))
    return fr, kids


def build_remove_lightning_warning(ox, oy):
    """Lightning from node — no seed backup; disconnect / remove from switcher."""
    fr = make_frame("01m Remove Lightning warning", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "REMOVE LIGHTNING?", size=18, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 150,
            310,
            72,
            fid,
            fid,
            "Removes this Lightning connection from Basic.\nFunds stay on your Lightning node.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_rect("card", ox + 28, oy + 250, 334, 100, fid, fid, fill="#141414", stroke="#333333", rx=12))
    kids.append(make_text("ct", ox + 44, oy + 272, 300, 22, fid, fid, "No recovery phrase", size=13, weight="700"))
    kids.append(
        make_text(
            "cd",
            ox + 44,
            oy + 304,
            300,
            36,
            fid,
            fid,
            "Node wallets have no seed to export.",
            size=13,
            color=CAPTION,
        )
    )
    kids.append(
        make_text(
            "rm",
            ox + 28,
            oy + 400,
            334,
            24,
            fid,
            fid,
            "Remove Lightning wallet",
            size=15,
            color="#E5484D",
            align="center",
        )
    )
    kids.append(make_rect("cancel", ox + 28, oy + 460, 334, 48, fid, fid, rx=10))
    kids.append(make_text("cancell", ox + 28, oy + 474, 334, 24, fid, fid, "Cancel", size=15, align="center"))
    return fr, kids


def build_activity(ox, oy):
    fr = make_frame("01d Activity sheet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += ghost_home_chrome(ox, oy, fid, fid)
    sheet_kids, top = bottom_sheet_chrome(ox, oy, fid, fid, sheet_h=560)
    kids += sheet_kids
    kids.append(make_text("st", ox + 28, top + 28, 334, 24, fid, fid, "Activity", size=16, weight="700"))
    rows = [
        ("↓", "Received", "in", "+50,000 sats", "today"),
        ("↑", "Sent", "out", "−25,000 sats", "yesterday"),
        ("↔", "Swap", "swap", "BTC → USDT", "Mar 12"),
        ("↓", "Received", "in", "+10,000 sats", "Mar 10"),
    ]
    for i, (letter, title, pill, amount, when) in enumerate(rows):
        yy = top + 70 + i * 88
        kids += person_row(ox + 28, yy, 334, letter, title, pill, f"{amount} · {when}", fid, fid, prefix=f"a{i}")
    return fr, kids


def build_tx_details(ox, oy):
    """On-chain / Ark — Notes last in list; Device as footer caption under buttons."""
    fr = make_frame("01h Transaction details", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 40, fid, fid, 0.7)
    kids.append(make_text("title", ox + 40, oy + 88, 310, 24, fid, fid, "TRANSACTION", size=18, weight="700", align="center"))
    kids.append(make_text("amt", ox + 40, oy + 122, 310, 30, fid, fid, "−25,000 sats", size=24, weight="700", align="center"))
    kids.append(make_text("fiat", ox + 40, oy + 156, 310, 18, fid, fid, "≈ EUR 12.18 · USD 13.14", size=12, color=CAPTION, align="center"))
    kids.append(make_rect("badge", ox + 120, oy + 184, 150, 24, fid, fid, fill="#1A1A1A", stroke="#555555", rx=8))
    kids.append(make_text("badgel", ox + 120, oy + 187, 150, 18, fid, fid, "Sent · on-chain", size=11, color=CAPTION, align="center"))
    rows = [
        ("Type", "On-chain payment"),
        ("Wallet", "Personal"),
        ("To", mid_ellipsis(DEMO_BC1, 8, 6)),
        ("Network fee", "210 sats"),
        ("Date", "Yesterday · 14:32"),
        ("Txid", mid_ellipsis("a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcd", 10, 8)),
        ("Notes", "Rent · March"),
    ]
    for i, (k, v) in enumerate(rows):
        yy = oy + 224 + i * 54
        kids.append(make_rect(f"d{i}-bg", ox + 28, yy, 334, 50, fid, fid, fill="#0D0D0D", stroke="#333333", rx=10))
        kids.append(make_text(f"d{i}-t", ox + 44, yy + 7, 300, 16, fid, fid, k, size=11, color="#8C8C8C"))
        kids.append(make_text(f"d{i}-v", ox + 44, yy + 24, 300, 20, fid, fid, v, size=13, weight="700"))
    kids.append(make_rect("copy", ox + 28, oy + 620, 160, 48, fid, fid, rx=10))
    kids.append(make_text("copyl", ox + 28, oy + 634, 160, 24, fid, fid, "Copy txid", size=14, align="center"))
    kids.append(make_rect("exp", ox + 202, oy + 620, 160, 48, fid, fid, rx=10))
    kids.append(make_text("expl", ox + 202, oy + 634, 160, 24, fid, fid, "View explorer", size=14, align="center"))
    kids.append(
        make_text(
            "device",
            ox + 28,
            oy + 690,
            334,
            24,
            fid,
            fid,
            "Sent with Pixel 8 · shiba",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    return fr, kids


def build_tx_details_ln(ox, oy):
    """Lightning — Notes last in list; Device as footer caption under buttons."""
    fr = make_frame("01i Transaction details LN", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 40, fid, fid, 0.7)
    kids.append(make_text("title", ox + 40, oy + 88, 310, 24, fid, fid, "TRANSACTION", size=18, weight="700", align="center"))
    kids.append(make_text("amt", ox + 40, oy + 122, 310, 30, fid, fid, "−12,000 sats", size=24, weight="700", align="center"))
    kids.append(make_text("fiat", ox + 40, oy + 156, 310, 18, fid, fid, "≈ EUR 5.84 · USD 6.30", size=12, color=CAPTION, align="center"))
    kids.append(make_rect("badge", ox + 115, oy + 184, 160, 24, fid, fid, fill="#1A1A1A", stroke="#555555", rx=8))
    kids.append(make_text("badgel", ox + 115, oy + 187, 160, 18, fid, fid, "Sent · Lightning", size=11, color=CAPTION, align="center"))
    rows = [
        ("Type", "Lightning payment"),
        ("Wallet", "Lightning · BTCPay"),
        ("To", mid_ellipsis(DEMO_LN, 10, 8)),
        ("Routing fee", "3 sats"),
        ("Date", "Today · 09:18"),
        ("Payment hash", mid_ellipsis("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", 10, 8)),
        ("Preimage", mid_ellipsis("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", 10, 8)),
        ("Notes", "Coffee"),
    ]
    for i, (k, v) in enumerate(rows):
        yy = oy + 220 + i * 50
        kids.append(make_rect(f"l{i}-bg", ox + 28, yy, 334, 46, fid, fid, fill="#0D0D0D", stroke="#333333", rx=10))
        kids.append(make_text(f"l{i}-t", ox + 44, yy + 5, 300, 14, fid, fid, k, size=11, color="#8C8C8C"))
        kids.append(make_text(f"l{i}-v", ox + 44, yy + 21, 300, 18, fid, fid, v, size=12, weight="700"))
    kids.append(make_rect("ch", ox + 28, oy + 640, 160, 44, fid, fid, rx=10))
    kids.append(make_text("chl", ox + 28, oy + 652, 160, 22, fid, fid, "Copy hash", size=13, align="center"))
    kids.append(make_rect("cp", ox + 202, oy + 640, 160, 44, fid, fid, rx=10))
    kids.append(make_text("cpl", ox + 202, oy + 652, 160, 22, fid, fid, "Copy preimage", size=13, align="center"))
    kids.append(
        make_text(
            "device",
            ox + 28,
            oy + 708,
            334,
            24,
            fid,
            fid,
            "Sent with Pixel 8 · shiba",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    return fr, kids


def icon_fingerprint(cx, cy, parent, frame):
    cmds = []
    for r in (8, 14, 20):
        cmds += circle(cx, cy, r, 20)
    cmds += line(cx, cy - 4, cx, cy + 10)
    return make_path("ico-bio", parent, frame, cmds, sw=1.6)


def build_lock_biometrics(ox, oy):
    fr = make_frame("01e Lock biometrics", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 120, fid, fid, 1.0)
    kids.append(make_text("title", ox + 40, oy + 220, 310, 28, fid, fid, "UNLOCK", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 260,
            310,
            40,
            fid,
            fid,
            "Confirm it's you.\nBiometrics preferred.",
            size=13,
            color="#8C8C8C",
            align="center",
        )
    )
    kids.append(make_rect("bio-ring", ox + 145, oy + 360, 100, 100, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", sw=2, rx=50))
    kids.append(icon_fingerprint(ox + 195, oy + 410, fid, fid))
    kids.append(make_text("bio-l", ox + 40, oy + 480, 310, 22, fid, fid, "Touch / Face ID", size=14, color="#8C8C8C", align="center"))
    kids.append(make_rect("pin", ox + 28, oy + 560, 334, 48, fid, fid, rx=10))
    kids.append(make_text("pin-l", ox + 28, oy + 574, 334, 24, fid, fid, "Use PIN instead", size=14, align="center"))
    return fr, kids


def build_lock_pin(ox, oy):
    fr = make_frame("01f Lock PIN", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 80, fid, fid, 0.9)
    kids.append(make_text("title", ox + 40, oy + 170, 310, 28, fid, fid, "ENTER PIN", size=20, weight="700", align="center"))
    for i in range(6):
        xx = ox + 95 + i * 36
        fill = "#FFFFFF" if i < 4 else "#111111"
        kids.append(make_rect(f"dot-{i}", xx, oy + 280, 18, 18, fid, fid, fill=fill, stroke="#FFFFFF", rx=9))
    keys = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]]
    pad_x, pad_y, pad_w, pad_h = ox + 50, oy + 340, 290, 280
    kids.append(make_rect("pad", pad_x, pad_y, pad_w, pad_h, fid, fid, fill="#0D0D0D", stroke="#333333", rx=16))
    cw, ch = pad_w / 3, pad_h / 4
    for r, row in enumerate(keys):
        for c, lab in enumerate(row):
            if not lab:
                continue
            kids.append(
                make_text(
                    f"k-{r}-{c}",
                    pad_x + c * cw,
                    pad_y + r * ch + ch / 2 - 12,
                    cw,
                    28,
                    fid,
                    fid,
                    lab,
                    size=22,
                    weight="700",
                    align="center",
                )
            )
    return fr, kids


def build_duress_home(ox, oy):
    fr = make_frame("01g Duress Home", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 145, oy + 70, fid, fid, 1.0)
    kids.append(make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "21,000 sats", size=28, weight="700", align="center"))
    kids.append(make_text("fiat", ox + 40, oy + 292, 310, 24, fid, fid, "EUR 10.24 / USD 11.05", size=13, color="#8C8C8C", align="center"))
    kids.append(make_rect("btn-receive", ox + 36, oy + 360, 140, 56, fid, fid, rx=10))
    kids.append(make_text("label-receive", ox + 36, oy + 376, 140, 24, fid, fid, "Receive", size=16, align="center"))
    kids.append(swap_arrows(ox + 195, oy + 388, fid, fid))
    kids.append(make_rect("btn-send", ox + 214, oy + 360, 140, 56, fid, fid, rx=10))
    kids.append(make_text("label-send", ox + 214, oy + 376, 140, 24, fid, fid, "Send", size=16, align="center"))
    kids.append(rates(ox, oy, fid, fid))
    cmds = line(ox + 185, oy + 680, ox + 195, oy + 672) + line(ox + 195, oy + 672, ox + 205, oy + 680)
    kids.append(make_path("hist-chevron", fid, fid, cmds, sw=1.8))
    kids.append(make_text("hist-hint", ox + 40, oy + 690, 310, 18, fid, fid, "swipe up for activity", size=12, color="#8C8C8C", align="center"))
    kids.append(make_rect("lock", ox + 28, oy + 730, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("lock-l", ox + 28, oy + 744, 334, 24, fid, fid, "Lock wallet", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids

def build_receive(ox, oy):
    fr = make_frame("02 Receive BIP21", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center"))
    kids.append(
        make_text("balance", ox + 40, oy + 145, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center")
    )
    kids.append(
        make_text(
            "fiat", ox + 40, oy + 182, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color=CAPTION, align="center"
        )
    )
    n, cell = 21, 13
    qr_px = n * cell
    qx = ox + (PHONE_W - qr_px) // 2
    qy = oy + 230
    kids += fake_qr(qx, qy, fid, fid, n=n, cell=cell)
    field_y = qy + qr_px + 36
    kids.append(make_rect("pill", ox + 28, field_y, 250, 48, fid, fid, stroke="#FFFFFF", rx=10))
    kids.append(
        make_text("bip21", ox + 36, field_y + 14, 230, 24, fid, fid, mid_ellipsis(DEMO_BIP21, 16, 6), size=11)
    )
    kids.append(icon_copy(ox + 302, field_y + 24, fid, fid))
    kids.append(icon_share(ox + 348, field_y + 24, fid, fid))
    kids.append(make_text("copy-l", ox + 280, field_y + 56, 50, 14, fid, fid, "Copy", size=10, color=CAPTION, align="center"))
    kids.append(
        make_text("share-l", ox + 328, field_y + 56, 50, 14, fid, fid, "Share", size=10, color=CAPTION, align="center")
    )
    return fr, kids


def build_receive_pos(ox, oy):
    """BTCPay-style amount keypad for receive (dark Basic chrome)."""
    fr = make_frame("02d Receive POS", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center"))
    kids.append(make_text("ccy", ox + 40, oy + 160, 310, 22, fid, fid, "EUR", size=14, color=CAPTION, weight="700", align="center"))
    kids.append(make_text("amt", ox + 40, oy + 190, 310, 64, fid, fid, "12,50", size=52, weight="700", align="center"))
    kids.append(
        make_text(
            "sats",
            ox + 40,
            oy + 258,
            310,
            20,
            fid,
            fid,
            "≈ 25,641 sats · USD 13.48",
            size=13,
            color=CAPTION,
            align="center",
        )
    )

    pad_x, pad_y = ox + 40, oy + 310
    pad_w, pad_h = 310, 340
    kids.append(make_rect("pad", pad_x, pad_y, pad_w, pad_h, fid, fid, fill="#141414", stroke="#333333", rx=16))
    keys = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["C", "0", "⌫"],
    ]
    cell_w, cell_h = pad_w / 3, pad_h / 4
    for r, row in enumerate(keys):
        for c, label in enumerate(row):
            cx = pad_x + c * cell_w
            cy = pad_y + r * cell_h
            kids.append(
                make_text(
                    f"k-{r}-{c}",
                    cx,
                    cy + cell_h / 2 - 14,
                    cell_w,
                    28,
                    fid,
                    fid,
                    label,
                    size=24 if label not in ("C", "⌫") else 20,
                    weight="700",
                    align="center",
                    color="#FFFFFF" if label not in ("C", "⌫") else CAPTION,
                )
            )

    kids.append(make_rect("cta", ox + 40, oy + 680, 310, 52, fid, fid, fill="#FFFFFF", stroke=None, rx=12))
    kids.append(
        make_text("ctal", ox + 40, oy + 694, 310, 28, fid, fid, "Request", size=17, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_receive_sheet(ox, oy):
    fr = make_frame("02b Receive sheet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        make_text("ghost", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center", color="#333333")
    )
    sheet_kids, top = bottom_sheet_chrome(ox, oy, fid, fid, sheet_h=480)
    kids += sheet_kids
    kids.append(make_text("st", ox + 28, top + 24, 334, 24, fid, fid, "Copy as…", size=16, weight="700"))
    rows = [
        ("BIP21 URL", mid_ellipsis(DEMO_BIP21, 18, 6)),
        ("Native segwit (bc1)", mid_ellipsis(DEMO_BC1, 10, 6)),
        ("Taproot", mid_ellipsis(DEMO_TAPROOT, 10, 6)),
        ("Ark address", mid_ellipsis(DEMO_ARK, 8, 6)),
        ("Lightning invoice", mid_ellipsis(DEMO_LN, 10, 6)),
    ]
    for i, (label, value) in enumerate(rows):
        yy = top + 60 + i * 72
        kids += value_row(ox + 28, yy, 334, label, value, fid, fid, prefix=f"fmt{i}")
    return fr, kids


def build_share_sheet(ox, oy):
    fr = make_frame("02c Receive share sheet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        make_text("ghost", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center", color="#333333")
    )
    sheet_kids, top = bottom_sheet_chrome(ox, oy, fid, fid, sheet_h=420)
    kids += sheet_kids
    kids.append(make_text("st", ox + 28, top + 28, 334, 24, fid, fid, "Share", size=16, weight="700"))
    kids.append(
        make_text(
            "share-preview",
            ox + 28,
            top + 70,
            334,
            70,
            fid,
            fid,
            f"This is my address:\n{mid_ellipsis(DEMO_BIP21, 18, 6)}",
            size=12,
        )
    )
    for i, label in enumerate(["Messages", "Mail", "Drive", "Copy"]):
        xx = ox + 28 + i * 86
        kids.append(make_rect(f"app-{i}", xx, top + 160, 70, 70, fid, fid, fill="#1A1A1A", stroke="#555555", rx=16))
        kids.append(make_text(f"al-{i}", xx, top + 240, 70, 18, fid, fid, label, size=10, color=CAPTION, align="center"))
    kids.append(make_rect("sys", ox + 28, top + 290, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text(
            "sysl", ox + 28, top + 304, 334, 24, fid, fid, "Share BIP21 via…", size=14, color="#000000", weight="700", align="center"
        )
    )
    return fr, kids


def build_send(ox, oy, *, ready=False, early=False, mid=False):
    if mid:
        name = "03d Send slide mid"
    elif early:
        name = "03c Send slide early"
    elif ready:
        name = "03b Send ready"
    else:
        name = "03 Send empty"
    fr = make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SEND", size=20, weight="700", align="center"))
    kids.append(make_text("balance", ox + 40, oy + 145, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center"))
    kids.append(make_text("fiat", ox + 40, oy + 182, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color=CAPTION, align="center"))
    kids.append(make_text("l-amt", ox + 28, oy + 220, 100, 18, fid, fid, "amount", size=12, color=CAPTION))
    kids.append(make_rect("f-amt", ox + 28, oy + 240, 334, 48, fid, fid, rx=10))
    if ready or early or mid:
        kids.append(make_text("v-amt", ox + 42, oy + 254, 280, 24, fid, fid, "25,000 sats", size=14))
        kids.append(
            make_text("sub", ox + 28, oy + 300, 320, 18, fid, fid, "≈ EUR 12.18 / USD 13.14", size=12, color=CAPTION)
        )
        kids.append(make_text("l-to", ox + 28, oy + 330, 100, 18, fid, fid, "to", size=12, color=CAPTION))
        kids.append(make_rect("f-to", ox + 28, oy + 350, 334, 48, fid, fid, rx=10))
        kids.append(make_text("v-to", ox + 42, oy + 364, 300, 24, fid, fid, mid_ellipsis(DEMO_BC1, 10, 6), size=14))
        kids.append(make_text("fee", ox + 28, oy + 410, 300, 18, fid, fid, "Network fee ~210 sats", size=12, color=CAPTION))
        if early:
            kids += elastic_slider(ox + 28, oy + 480, fid, fid, progress=0.18, label_color="#FFFFFF")
        elif mid:
            kids += elastic_slider(ox + 28, oy + 480, fid, fid, progress=0.92, label="release to send", label_color="#1A1A1A")
        else:
            kids += elastic_slider(ox + 28, oy + 480, fid, fid, progress=0.72, label_color="#1A1A1A")
    else:
        kids.append(make_text("ph-amt", ox + 42, oy + 254, 280, 24, fid, fid, "enter amount", size=14, color=HINT))
        kids.append(make_text("l-to", ox + 28, oy + 330, 100, 18, fid, fid, "to", size=12, color=CAPTION))
        kids.append(make_rect("f-to", ox + 28, oy + 350, 334, 48, fid, fid, rx=10))
        kids.append(make_text("ph-to", ox + 42, oy + 364, 280, 24, fid, fid, "address / npub / contact", size=14, color=HINT))
        kids.append(make_rect("btn", ox + 28, oy + 420, 334, 48, fid, fid, rx=10))
        kids.append(make_text("choose", ox + 28, oy + 434, 334, 24, fid, fid, "Choose Recipient", size=16, align="center"))
        d = 72
        cx, cy = ox + 195, oy + 720
        kids.append(
            make_rect("scan-circle", cx - d / 2, cy - d / 2, d, d, fid, fid, fill="#111111", stroke="#FFFFFF", sw=2, rx=d / 2)
        )
        kids.append(camera_lens(cx, cy - 2, fid, fid))
        kids.append(make_text("scan", cx - 40, cy + 44, 80, 18, fid, fid, "Scan", size=11, color=CAPTION, align="center"))
    return fr, kids


def build_send_success(ox, oy):
    fr = make_frame("03e Send success", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SENT", size=20, weight="700", align="center"))
    kids.append(make_text("amt", ox + 40, oy + 160, 310, 40, fid, fid, "25,000 sats", size=28, weight="700", align="center"))
    kids.append(make_text("fiat", ox + 40, oy + 206, 310, 20, fid, fid, "≈ EUR 12.18 / USD 13.14", size=13, color=CAPTION, align="center"))
    kids += value_row(ox + 28, oy + 260, 334, "To", mid_ellipsis(DEMO_BC1, 10, 6), fid, fid, prefix="to")
    kids += value_row(ox + 28, oy + 336, 334, "Network fee", "~210 sats", fid, fid, prefix="fee")
    kids += value_row(ox + 28, oy + 412, 334, "Status", "Broadcast · unconfirmed", fid, fid, prefix="st")
    kids.append(make_rect("det", ox + 28, oy + 520, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("detl", ox + 28, oy + 534, 334, 24, fid, fid, "View transaction", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(make_rect("done", ox + 28, oy + 584, 334, 48, fid, fid, rx=10))
    kids.append(make_text("donel", ox + 28, oy + 598, 334, 24, fid, fid, "Done", size=14, color=CAPTION, align="center"))
    return fr, kids


def build_scan_qr(ox, oy):
    """Full-screen QR scanner — Send / Connect / Receive."""
    fr = make_frame("03f Scan QR", ox, oy)
    fid = fr["id"]
    kids = []
    kids.append(make_rect("bg", ox, oy, PHONE_W, PHONE_H, fid, fid, fill="#000000", stroke=None, rx=28))
    kids.append(make_text("title", ox + 40, oy + 56, 310, 28, fid, fid, "SCAN", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 92,
            310,
            36,
            fid,
            fid,
            "Address · BIP21 · Lightning · invite",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    # Viewfinder
    box = 240
    bx, by = ox + (PHONE_W - box) // 2, oy + 200
    kids.append(make_rect("vf", bx, by, box, box, fid, fid, fill="#0A0A0A", stroke="#FFFFFF", sw=2, rx=16))
    kids.append(camera_lens(ox + PHONE_W // 2, by + box // 2, fid, fid))
    kids.append(
        make_text("hint", ox + 28, by + box + 28, 334, 40, fid, fid, "Align code inside the frame", size=12, color=HINT, align="center")
    )
    kids.append(make_rect("paste", ox + 28, oy + 720, 334, 48, fid, fid, rx=10))
    kids.append(make_text("pastel", ox + 28, oy + 734, 334, 24, fid, fid, "Paste instead", size=14, align="center"))
    kids.append(make_text("cancel", ox + 28, oy + 788, 334, 20, fid, fid, "Cancel", size=12, color=CAPTION, align="center"))
    return fr, kids


def build_swap(ox, oy):
    fr = make_frame("04 Swap BTC to USDT", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SWAP", size=20, weight="700", align="center"))
    kids.append(make_rect("card-from", ox + 28, oy + 160, 334, 80, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
    kids.append(make_text("from-l", ox + 44, oy + 175, 200, 18, fid, fid, "From Bitcoin", size=12, color=CAPTION))
    kids.append(make_text("from-v", ox + 44, oy + 200, 250, 28, fid, fid, "100,000 sats", size=18, weight="700"))
    kids.append(swap_arrows(ox + 195, oy + 268, fid, fid))
    kids.append(make_rect("card-to", ox + 28, oy + 300, 334, 80, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
    kids.append(make_text("to-l", ox + 44, oy + 315, 200, 18, fid, fid, "To USDT", size=12, color=CAPTION))
    kids.append(make_text("to-v", ox + 44, oy + 340, 250, 28, fid, fid, "76.42 USDT", size=18, weight="700"))
    kids.append(make_text("rate", ox + 28, oy + 405, 330, 18, fid, fid, "1 BTC ≈ USD 76,420", size=12, color=CAPTION))
    kids += elastic_slider(ox + 28, oy + 470, fid, fid, progress=0.35, label="slide to swap", label_color="#FFFFFF")
    return fr, kids


def build_swap_success(ox, oy):
    fr = make_frame("04b Swap success", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SWAPPED", size=20, weight="700", align="center"))
    kids.append(make_text("amt", ox + 40, oy + 160, 310, 36, fid, fid, "76.42 USDT", size=26, weight="700", align="center"))
    kids.append(make_text("sub", ox + 40, oy + 204, 310, 20, fid, fid, "from 100,000 sats", size=13, color=CAPTION, align="center"))
    kids += value_row(ox + 28, oy + 260, 334, "Rate", "1 BTC ≈ USD 76,420", fid, fid, prefix="rt")
    kids += value_row(ox + 28, oy + 336, 334, "Fee", "included in quote", fid, fid, prefix="fee")
    kids += value_row(ox + 28, oy + 412, 334, "Status", "Complete", fid, fid, prefix="st")
    kids.append(make_rect("done", ox + 28, oy + 520, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("donel", ox + 28, oy + 534, 334, 24, fid, fid, "Done", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_node(ox, oy):
    fr = make_frame("06 Connect Node", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CONNECT NODE", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            48,
            fid,
            fid,
            "Link LND for Lightning payments.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    for i, (letter, t, kind, d) in enumerate(
        [
            ("B", "BTCPay Server", "BTCPay", "Guided server link"),
            ("N", "Nostr Wallet Connect", "NWC", "Paste connection string"),
            ("M", "Manual LND", "macaroon", "Endpoint · payments only"),
        ]
    ):
        yy = oy + 210 + i * 100
        kids += person_row(ox + 28, yy, 334, letter, t, kind, d, fid, fid, prefix=f"n{i}")
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 540,
            334,
            40,
            fid,
            fid,
            "Send / receive only.\nNo channel management in-app.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_connect_btcpay(ox, oy):
    """BTCPay guided pairing."""
    fr = make_frame("06b Connect BTCPay", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "BTCPAY", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "Connect LND through your BTCPay server.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("lu", ox + 28, oy + 210, 200, 18, fid, fid, "server URL", size=12, color="#8C8C8C"))
    kids.append(make_rect("fu", ox + 28, oy + 232, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vu", ox + 42, oy + 246, 300, 24, fid, fid, "https://btcpay.example.com", size=13, color="#8C8C8C"))
    kids.append(make_text("lp", ox + 28, oy + 300, 200, 18, fid, fid, "pairing code / access token", size=12, color="#8C8C8C"))
    kids.append(make_rect("fp", ox + 28, oy + 322, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vp", ox + 42, oy + 336, 300, 24, fid, fid, "paste from BTCPay", size=13, color="#595959"))
    kids.append(make_rect("scan", ox + 28, oy + 390, 334, 48, fid, fid, rx=10))
    kids.append(make_text("scanl", ox + 28, oy + 404, 334, 24, fid, fid, "Scan pairing QR", size=14, align="center"))
    kids.append(make_rect("cta", ox + 28, oy + 470, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 484, 334, 24, fid, fid, "Connect BTCPay", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 545,
            334,
            40,
            fid,
            fid,
            "Payments only — no channel management.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_connect_nwc(ox, oy):
    """Nostr Wallet Connect string paste."""
    fr = make_frame("06c Connect NWC", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NWC", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "Paste a Nostr Wallet Connect string.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("ln", ox + 28, oy + 210, 200, 18, fid, fid, "connection string", size=12, color="#8C8C8C"))
    kids.append(make_rect("fn", ox + 28, oy + 232, 334, 120, fid, fid, rx=12))
    kids.append(
        make_text(
            "vn",
            ox + 42,
            oy + 250,
            300,
            90,
            fid,
            fid,
            "nostr+walletconnect://…\nrelay=wss://…&secret=…",
            size=12,
            color="#8C8C8C",
        )
    )
    kids.append(make_rect("paste", ox + 28, oy + 372, 334, 48, fid, fid, rx=10))
    kids.append(make_text("pastel", ox + 28, oy + 386, 334, 24, fid, fid, "Paste from clipboard", size=14, align="center"))
    kids.append(make_rect("cta", ox + 28, oy + 450, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 464, 334, 24, fid, fid, "Connect NWC", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 530,
            334,
            40,
            fid,
            fid,
            "Revoke the connection string on the host to disconnect.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_connect_manual_lnd(ox, oy):
    """Manual LND endpoint + macaroon."""
    fr = make_frame("06d Connect Manual LND", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "MANUAL LND", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "Endpoint + macaroon for operators.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("le", ox + 28, oy + 200, 200, 18, fid, fid, "REST endpoint", size=12, color="#8C8C8C"))
    kids.append(make_rect("fe", ox + 28, oy + 222, 334, 48, fid, fid, rx=10))
    kids.append(make_text("ve", ox + 42, oy + 236, 300, 24, fid, fid, "https://lnd.home.lan:8080", size=13, color="#8C8C8C"))
    kids.append(make_text("lm", ox + 28, oy + 290, 200, 18, fid, fid, "macaroon (hex / file)", size=12, color="#8C8C8C"))
    kids.append(make_rect("fm", ox + 28, oy + 312, 334, 72, fid, fid, rx=10))
    kids.append(make_text("vm", ox + 42, oy + 330, 300, 40, fid, fid, "020103…  (invoice + payments)", size=12, color="#595959"))
    kids.append(make_text("lt", ox + 28, oy + 404, 200, 18, fid, fid, "TLS cert", size=12, color="#8C8C8C"))
    kids.append(make_rect("ft", ox + 28, oy + 426, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vt", ox + 42, oy + 440, 300, 24, fid, fid, "optional · paste or skip", size=13, color="#595959"))
    kids.append(make_rect("cta", ox + 28, oy + 510, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 524, 334, 24, fid, fid, "Connect LND", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 580,
            334,
            40,
            fid,
            fid,
            "Payments-only macaroon recommended.\nNo channel open/close in Basic.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_node_status(ox, oy):
    fr = make_frame("13 Node Status", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NODE STATUS", size=20, weight="700", align="center"))
    kids.append(make_rect("ok", ox + 28, oy + 160, 334, 110, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=12))
    kids.append(make_text("ok-t", ox + 44, oy + 178, 300, 28, fid, fid, "Connected · Lightning", size=16, weight="700"))
    kids.append(make_text("ok-d", ox + 44, oy + 212, 300, 20, fid, fid, "type · BTCPay", size=12, color=CAPTION))
    kids.append(make_text("ok-b", ox + 44, oy + 236, 300, 20, fid, fid, "balance · 812,400 sats (separate)", size=12, color=CAPTION))
    for i, (k, v) in enumerate([("Alias", "basic-node"), ("Peers", "8"), ("Mode", "payments only")]):
        yy = oy + 300 + i * 72
        kids += value_row(ox + 28, yy, 334, k, v, fid, fid, prefix=f"m{i}")
    kids.append(make_rect("disc", ox + 28, oy + 540, 334, 48, fid, fid, rx=10))
    kids.append(make_text("discl", ox + 28, oy + 554, 334, 24, fid, fid, "Disconnect", size=14, color="#8C8C8C", align="center"))
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 620,
            334,
            40,
            fid,
            fid,
            "Funds stay on your node.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_settings(ox, oy):
    """Expo Settings hub: Display currencies → Account → Wallet Settings → Arkade / Reset / About."""
    fr = make_frame("05 Settings", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 40, fid, fid, 0.77)
    kids.append(
        make_text("title", ox + 40, oy + 92, 310, 28, fid, fid, "SETTINGS", size=20, weight="700", align="center")
    )

    blocks = [
        ("row", "Display currencies", False),
        ("sec", "Account", False),
        ("row", "Privacy", False),
        ("row", "Nostr identity", False),
        ("row", "Contacts", False),
        ("row", "Duress PIN", False),
        ("sec", "Wallet Settings", False),
        ("row", "Connected node", False),
        ("row", "Hardware wallet", False),
        ("row", "Multisig", False),
        ("row", "Backup", False),
        ("row", "Restore", False),
        ("sec", "Provider Settings", False),
        ("row", "Arkade", False),
        ("row", "Reset app", True),
        ("row", "About", False),
    ]

    y = oy + 128
    row_i = 0
    for kind, label, danger in blocks:
        if kind == "sec":
            kids += settings_section_label(ox + 28, y, 334, label, fid, fid, prefix=f"sec{row_i}")
            y += 22
        else:
            kids += nav_row(ox + 28, y, 334, label, fid, fid, prefix=f"s{row_i}", danger=danger)
            y += 52
            row_i += 1

    need_h = int(y - oy + 28)
    if need_h > PHONE_H:
        geom(fr, ox, oy, PHONE_W, need_h)
    return fr, kids


def build_arkade_settings(ox, oy):
    fr = make_frame("05as Arkade Settings", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        make_text(
            "title",
            ox + 40,
            oy + 100,
            310,
            28,
            fid,
            fid,
            "ARKADE",
            size=20,
            weight="700",
            align="center",
        )
    )
    items = [
        ("Delegates", False),
        ("Recovery address", False),
        ("Collaborative Exit", False),
        ("Unilateral Exit", True),
    ]
    for i, (label, danger) in enumerate(items):
        yy = oy + 150 + i * 56
        kids += nav_row(ox + 28, yy, 334, label, fid, fid, prefix=f"a{i}", danger=danger)
    return fr, kids


def build_currencies(ox, oy):
    fr = make_frame("05b Display currencies", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CURRENCIES", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            18,
            fid,
            fid,
            "Shown under balances on Home.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    for i, (code, on) in enumerate([("USD", True), ("EUR", True), ("GBP", False), ("JPY", False)]):
        yy = oy + 170 + i * 76
        kids += value_row(ox + 28, yy, 334, code, "ON" if on else "OFF", fid, fid, prefix=f"c{i}")
    return fr, kids


def build_hw(ox, oy):
    fr = make_frame("07 Hardware Wallet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "HARDWARE", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "Pair a signing device.\nKeys never leave the hardware.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    for i, (letter, n, kind) in enumerate([("L", "Ledger", "BLE"), ("T", "Trezor", "USB"), ("C", "Coldcard", "airgap")]):
        yy = oy + 210 + i * 88
        kids += person_row(ox + 28, yy, 334, letter, n, kind, "Not paired", fid, fid, prefix=f"h{i}")
    kids.append(make_rect("pair", ox + 28, oy + 500, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("pairl", ox + 28, oy + 514, 334, 24, fid, fid, "Pair device", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_hw_pair(ox, oy):
    fr = make_frame("07b Pair hardware", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "PAIR", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "Unlock the device and keep it nearby.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids += person_row(ox + 28, oy + 200, 334, "T", "Trezor", "USB", "Searching…", fid, fid, selected=True, prefix="dev")
    kids.append(make_rect("scan", ox + 28, oy + 310, 334, 48, fid, fid, rx=10))
    kids.append(make_text("scanl", ox + 28, oy + 324, 334, 24, fid, fid, "Scan pairing QR", size=14, align="center"))
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 390,
            334,
            48,
            fid,
            fid,
            "Seeds never leave the device.\nBasic only requests signatures.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    kids.append(make_rect("cancel", ox + 28, oy + 520, 334, 48, fid, fid, rx=10))
    kids.append(make_text("cancell", ox + 28, oy + 534, 334, 24, fid, fid, "Cancel", size=14, color=CAPTION, align="center"))
    return fr, kids


def build_hw_confirm(ox, oy):
    """Handoff from Send / Multisig when hardware is paired."""
    fr = make_frame("07c Confirm on device", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CONFIRM", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "Approve this spend on your device.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids += value_row(ox + 28, oy + 200, 334, "Amount", "25,000 sats", fid, fid, prefix="amt")
    kids += value_row(ox + 28, oy + 276, 334, "To", mid_ellipsis(DEMO_BC1, 10, 6), fid, fid, prefix="to")
    kids += value_row(ox + 28, oy + 352, 334, "Device", "Trezor · waiting", fid, fid, prefix="dev")
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 450,
            334,
            40,
            fid,
            fid,
            "Keep the cable / BLE connection active.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    kids.append(make_rect("cancel", ox + 28, oy + 540, 334, 48, fid, fid, rx=10))
    kids.append(make_text("cancell", ox + 28, oy + 554, 334, 24, fid, fid, "Cancel", size=14, color=CAPTION, align="center"))
    return fr, kids


def contact_initial_avatar(cx, cy, r, letter, parent, frame):
    """Monochrome circle with one letter — Basic style, no color."""
    kids = []
    kids.append(make_rect("av", cx - r, cy - r, 2 * r, 2 * r, parent, frame, fill="#1A1A1A", stroke="#FFFFFF", sw=1.5, rx=r))
    kids.append(
        make_text("av-l", cx - r, cy - 9, 2 * r, 20, parent, frame, letter.upper(), size=14, weight="700", align="center")
    )
    return kids


def type_pill(ox, oy, w, label, parent, frame, *, prefix="pill"):
    kids = []
    kids.append(make_rect(prefix, ox, oy, w, 20, parent, frame, fill="#1A1A1A", stroke="#555555", rx=4))
    kids.append(make_text(f"{prefix}-l", ox, oy + 2, w, 16, parent, frame, label, size=9, color=CAPTION, align="center"))
    return kids


def person_row(ox, yy, w, letter, title, pill, subtitle, parent, frame, *, selected=False, prefix="pr"):
    """Contacts-style list row: avatar · title · type pill · mid-ellipsis · chevron."""
    kids = []
    stroke = "#FFFFFF" if selected else "#333333"
    kids.append(make_rect(f"{prefix}-bg", ox, yy, w, 76, parent, frame, fill="#0D0D0D", stroke=stroke, rx=12))
    kids += contact_initial_avatar(ox + 32, yy + 38, 18, letter, parent, frame)
    kids.append(make_text(f"{prefix}-t", ox + 64, yy + 14, 200, 22, parent, frame, title, size=15, weight="700"))
    pill_w = max(48, 8 * len(pill) + 16)
    kids += type_pill(ox + 64, yy + 40, pill_w, pill, parent, frame, prefix=f"{prefix}-pill")
    kids.append(
        make_text(f"{prefix}-s", ox + 64 + pill_w + 8, yy + 40, w - (64 + pill_w + 48), 20, parent, frame, subtitle, size=11, color=CAPTION)
    )
    kids.append(make_text(f"{prefix}-ch", ox + w - 40, yy + 26, 30, 24, parent, frame, "›", size=18, color="#666666", align="right"))
    return kids


def nav_row(ox, yy, w, title, parent, frame, *, value=None, prefix="nr", danger=False):
    """Settings-style nav row matching Contacts chrome."""
    kids = []
    label_color = "#E07070" if danger else "#FFFFFF"
    chev_color = "#E07070" if danger else "#666666"
    kids.append(make_rect(f"{prefix}-bg", ox, yy, w, 56, parent, frame, fill="#0D0D0D", stroke="#333333", rx=12))
    kids.append(
        make_text(
            f"{prefix}-t",
            ox + 16,
            yy + 16,
            220,
            22,
            parent,
            frame,
            title,
            size=14,
            weight="700",
            color=label_color,
        )
    )
    if value is not None:
        kids.append(
            make_text(
                f"{prefix}-v",
                ox + 180,
                yy + 16,
                110,
                22,
                parent,
                frame,
                value,
                size=12,
                color=CAPTION,
                align="right",
            )
        )
    kids.append(
        make_text(
            f"{prefix}-ch",
            ox + w - 36,
            yy + 14,
            24,
            24,
            parent,
            frame,
            "›",
            size=18,
            color=chev_color,
            align="right",
        )
    )
    return kids


def settings_section_label(ox, yy, w, title, parent, frame, *, prefix="sec"):
    return [
        make_text(
            f"{prefix}-{title}",
            ox,
            yy,
            w,
            18,
            parent,
            frame,
            title.upper(),
            size=11,
            color="#999999",
            weight="700",
        )
    ]


def value_row(ox, yy, w, title, value, parent, frame, *, prefix="vr"):
    """Two-line value row (settings detail)."""
    kids = []
    kids.append(make_rect(f"{prefix}-bg", ox, yy, w, 64, parent, frame, fill="#0D0D0D", stroke="#333333", rx=12))
    kids.append(make_text(f"{prefix}-t", ox + 16, yy + 12, 280, 20, parent, frame, title, size=13, weight="700"))
    kids.append(make_text(f"{prefix}-v", ox + 16, yy + 36, 280, 18, parent, frame, value, size=12, color=CAPTION))
    return kids


def kv_inline_rows(ox, yy, w, rows, parent, frame, *, prefix="kv", row_h=36):
    """Single card: label left / value right (arkade.money About style, Basic chrome)."""
    kids = []
    h = len(rows) * row_h + 8
    kids.append(make_rect(f"{prefix}-bg", ox, yy, w, h, parent, frame, fill="#0D0D0D", stroke="#333333", rx=12))
    for i, (label, value) in enumerate(rows):
        ry = yy + 4 + i * row_h
        if i > 0:
            kids.append(
                make_rect(
                    f"{prefix}-div{i}",
                    ox + 14,
                    ry,
                    w - 28,
                    1,
                    parent,
                    frame,
                    fill="#2A2A2A",
                    stroke=None,
                    rx=0,
                )
            )
        kids.append(
            make_text(f"{prefix}-l{i}", ox + 14, ry + 10, 130, 18, parent, frame, label, size=11, color=CAPTION)
        )
        kids.append(
            make_text(
                f"{prefix}-v{i}",
                ox + 140,
                ry + 10,
                w - 154,
                18,
                parent,
                frame,
                value,
                size=11,
                weight="700",
                align="right",
            )
        )
    return kids, h


def build_about(ox, oy):
    """Settings → About: logo, app caption, Arkade ASP info, version/license/repo footer."""
    fr = make_frame("05f About", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 40, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 92, 310, 28, fid, fid, "ABOUT", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "caption",
            ox + 36,
            oy + 126,
            318,
            72,
            fid,
            fid,
            "Bitcoin p2p payments, for your daily needs.\n"
            "Your money, your keys.\n"
            "Powered by Arkade, Nostr, LND.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(
        make_text("ark-h", ox + 28, oy + 210, 334, 18, fid, fid, "ARKADE", size=11, weight="700", color=HINT)
    )
    # Mirror arkade.money About fields; Wallet mode = hd (Basic mandatory, not static)
    ark_rows = [
        ("Server URL", "https://arkade.computer"),
        ("Server pubkey", mid_ellipsis("038202bebdd5f0d097779c038202bebdd5f0d097779c", 11, 11)),
        ("Forfeit address", mid_ellipsis("bc1qzzdzp5c2y7e5aq50rszzdzp5c2y7e5aq50rs", 11, 11)),
        ("Network", "bitcoin"),
        ("Dust", "330 sats"),
        ("Session duration", "1 minute"),
        ("Boarding exit delay", "90 days"),
        ("Unilateral exit delay", "7 days"),
        ("Wallet mode", "hd"),
        ("Git commit hash", "82a35178"),
    ]
    card_kids, card_h = kv_inline_rows(ox + 28, oy + 232, 334, ark_rows, fid, fid, prefix="ark")
    kids += card_kids
    foot_y = oy + 232 + card_h + 28
    kids.append(
        make_text("ver", ox + 28, foot_y, 334, 18, fid, fid, "Version  0.1.0", size=12, color=CAPTION, align="center")
    )
    kids.append(
        make_text(
            "lic",
            ox + 28,
            foot_y + 24,
            334,
            18,
            fid,
            fid,
            "License  ·  Open source",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(
        make_text(
            "gh",
            ox + 28,
            foot_y + 48,
            334,
            18,
            fid,
            fid,
            "GitHub  ·  theDavidCoen/BasicWallet",
            size=11,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_contacts(ox, oy):
    """Private directory list — refined Basic layout."""
    fr = make_frame("08 Contacts", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CONTACTS", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            18,
            fid,
            fid,
            "Private · encrypted · no OS contacts",
            size=11,
            color="#8C8C8C",
            align="center",
        )
    )
    # Search affordance
    kids.append(make_rect("search", ox + 28, oy + 168, 334, 44, fid, fid, fill="#111111", stroke="#555555", rx=10))
    kids.append(make_text("sq", ox + 44, oy + 180, 280, 22, fid, fid, "Search name or id…", size=13, color="#595959"))

    contacts = [
        ("Alice", "npub", mid_ellipsis(DEMO_NPUB_ALICE, 10, 6), "A"),
        ("Bob", "lnurl", mid_ellipsis(DEMO_LNURL, 8, 6), "B"),
        ("Carol", "bc1", mid_ellipsis(DEMO_BC1, 8, 6), "C"),
        ("Dave", "NIP-05", "dave@nostr.example", "D"),
    ]
    for i, (name, kind, ident, letter) in enumerate(contacts):
        yy = oy + 232 + i * 88
        kids.append(make_rect(f"c-{i}", ox + 28, yy, 334, 76, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids += contact_initial_avatar(ox + 60, yy + 38, 18, letter, fid, fid)
        kids.append(make_text(f"n-{i}", ox + 92, yy + 14, 200, 22, fid, fid, name, size=15, weight="700"))
        # type pill
        kids.append(make_rect(f"pill-{i}", ox + 92, yy + 40, 56, 20, fid, fid, fill="#1A1A1A", stroke="#555555", rx=4))
        kids.append(make_text(f"k-{i}", ox + 92, yy + 42, 56, 16, fid, fid, kind, size=9, color="#8C8C8C", align="center"))
        kids.append(make_text(f"id-{i}", ox + 156, yy + 40, 170, 20, fid, fid, ident, size=11, color="#8C8C8C"))
        kids.append(make_text(f"ch-{i}", ox + 320, yy + 26, 30, 24, fid, fid, "›", size=18, color="#666666", align="right"))

    kids.append(
        make_text("count", ox + 28, oy + 600, 334, 18, fid, fid, f"{len(contacts)} contacts", size=11, color="#666666", align="center")
    )
    kids.append(make_rect("add", ox + 28, oy + 640, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("add-l", ox + 28, oy + 654, 334, 24, fid, fid, "+ Add contact", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_contacts_search(ox, oy):
    fr = make_frame("08d Contacts search", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CONTACTS", size=20, weight="700", align="center"))
    kids.append(make_rect("search", ox + 28, oy + 160, 334, 48, fid, fid, fill="#111111", stroke="#FFFFFF", rx=10))
    kids.append(make_text("sq", ox + 44, oy + 174, 260, 24, fid, fid, "bo|", size=14))
    kids.append(make_text("clr", ox + 300, oy + 174, 50, 24, fid, fid, "✕", size=14, color="#8C8C8C", align="center"))
    kids.append(make_text("hint", ox + 28, oy + 220, 334, 18, fid, fid, "1 match", size=11, color="#666666"))
    # Hit row
    yy = oy + 250
    kids.append(make_rect("hit", ox + 28, yy, 334, 76, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=12))
    kids += contact_initial_avatar(ox + 60, yy + 38, 18, "B", fid, fid)
    kids.append(make_text("hn", ox + 92, yy + 14, 200, 22, fid, fid, "Bob", size=15, weight="700"))
    kids.append(make_rect("pill", ox + 92, yy + 40, 56, 20, fid, fid, fill="#1A1A1A", stroke="#555555", rx=4))
    kids.append(make_text("hk", ox + 92, yy + 42, 56, 16, fid, fid, "lnurl", size=9, color="#8C8C8C", align="center"))
    kids.append(make_text("hi", ox + 156, yy + 40, 170, 20, fid, fid, mid_ellipsis(DEMO_LNURL, 8, 6), size=11, color="#8C8C8C"))
    kids.append(make_text("ch", ox + 320, yy + 26, 30, 24, fid, fid, "›", size=18, color="#666666", align="right"))
    return fr, kids


def build_choose_recipient(ox, oy):
    fr = make_frame("08b Choose Recipient", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECIPIENT", size=20, weight="700", align="center"))
    kids.append(
        make_text("sub", ox + 40, oy + 132, 310, 18, fid, fid, "From contacts or paste", size=12, color="#8C8C8C", align="center")
    )
    # Paste first as primary action
    kids.append(make_rect("paste", ox + 28, oy + 170, 334, 52, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text(
            "pastel", ox + 28, oy + 184, 334, 24, fid, fid, "Paste address / npub", size=14, color="#000000", weight="700", align="center"
        )
    )
    kids.append(make_text("or", ox + 28, oy + 240, 334, 18, fid, fid, "or pick a contact", size=11, color="#666666", align="center"))
    for i, (name, kind, ident, letter) in enumerate(
        [
            ("Alice", "npub", mid_ellipsis(DEMO_NPUB_ALICE, 10, 6), "A"),
            ("Bob", "lnurl", mid_ellipsis(DEMO_LNURL, 8, 6), "B"),
            ("Carol", "bc1", mid_ellipsis(DEMO_BC1, 8, 6), "C"),
        ]
    ):
        yy = oy + 270 + i * 88
        kids.append(make_rect(f"r-{i}", ox + 28, yy, 334, 76, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids += contact_initial_avatar(ox + 60, yy + 38, 18, letter, fid, fid)
        kids.append(make_text(f"rn-{i}", ox + 92, yy + 14, 200, 22, fid, fid, name, size=15, weight="700"))
        kids.append(make_rect(f"rp-{i}", ox + 92, yy + 40, 56, 20, fid, fid, fill="#1A1A1A", stroke="#555555", rx=4))
        kids.append(make_text(f"rk-{i}", ox + 92, yy + 42, 56, 16, fid, fid, kind, size=9, color="#8C8C8C", align="center"))
        kids.append(make_text(f"ri-{i}", ox + 156, yy + 40, 170, 20, fid, fid, ident, size=11, color="#8C8C8C"))
    return fr, kids


def build_edit_contact(ox, oy):
    fr = make_frame("08c Edit contact", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "EDIT CONTACT", size=20, weight="700", align="center"))
    kids += contact_initial_avatar(ox + 195, oy + 175, 28, "B", fid, fid)
    kids.append(make_text("ln", ox + 28, oy + 230, 100, 18, fid, fid, "name", size=12, color="#8C8C8C"))
    kids.append(make_rect("fn", ox + 28, oy + 252, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vn", ox + 42, oy + 266, 300, 24, fid, fid, "Bob", size=14))
    kids.append(make_text("lt", ox + 28, oy + 320, 120, 18, fid, fid, "type", size=12, color="#8C8C8C"))
    # type chips
    for i, (lab, on) in enumerate([("bc1", False), ("npub", False), ("lnurl", True), ("NIP-05", False)]):
        xx = ox + 28 + i * 86
        fill = "#FFFFFF" if on else None
        stroke = None if on else "#555555"
        kids.append(make_rect(f"chip-{i}", xx, oy + 342, 78, 32, fid, fid, fill=fill or "#111111", stroke=stroke or "#555555", rx=8))
        kids.append(
            make_text(
                f"cl-{i}",
                xx,
                oy + 348,
                78,
                20,
                fid,
                fid,
                lab,
                size=11,
                color="#000000" if on else CAPTION,
                weight="700" if on else "400",
                align="center",
            )
        )
    kids.append(make_text("li", ox + 28, oy + 400, 160, 18, fid, fid, "identifier", size=12, color="#8C8C8C"))
    kids.append(make_rect("fi", ox + 28, oy + 422, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vi", ox + 42, oy + 436, 300, 24, fid, fid, mid_ellipsis(DEMO_LNURL, 12, 6), size=12))
    kids.append(make_rect("save", ox + 28, oy + 510, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(make_text("savel", ox + 28, oy + 524, 334, 24, fid, fid, "Save", size=16, color="#000000", weight="700", align="center"))
    kids.append(make_rect("del", ox + 28, oy + 580, 334, 48, fid, fid, rx=10))
    kids.append(make_text("dell", ox + 28, oy + 594, 334, 24, fid, fid, "Delete contact", size=14, color="#8C8C8C", align="center"))
    return fr, kids


def build_add_contact(ox, oy):
    fr = make_frame("08e Add contact", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ADD CONTACT", size=20, weight="700", align="center"))
    kids.append(
        make_text("sub", ox + 40, oy + 132, 310, 18, fid, fid, "Name + one identifier", size=12, color=CAPTION, align="center")
    )
    kids.append(make_text("ln", ox + 28, oy + 180, 100, 18, fid, fid, "name", size=12, color="#8C8C8C"))
    kids.append(make_rect("fn", ox + 28, oy + 202, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vn", ox + 42, oy + 216, 300, 24, fid, fid, "Eve", size=14, color=HINT))
    kids.append(make_text("lt", ox + 28, oy + 270, 120, 18, fid, fid, "type", size=12, color="#8C8C8C"))
    for i, (lab, on) in enumerate([("bc1", False), ("npub", True), ("lnurl", False), ("NIP-05", False)]):
        xx = ox + 28 + i * 86
        kids.append(
            make_rect(
                f"chip-{i}",
                xx,
                oy + 292,
                78,
                32,
                fid,
                fid,
                fill="#FFFFFF" if on else "#111111",
                stroke=None if on else "#555555",
                rx=8,
            )
        )
        kids.append(
            make_text(
                f"cl-{i}",
                xx,
                oy + 298,
                78,
                20,
                fid,
                fid,
                lab,
                size=11,
                color="#000000" if on else CAPTION,
                weight="700" if on else "400",
                align="center",
            )
        )
    kids.append(make_text("li", ox + 28, oy + 350, 160, 18, fid, fid, "identifier", size=12, color="#8C8C8C"))
    kids.append(make_rect("fi", ox + 28, oy + 372, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vi", ox + 42, oy + 386, 300, 24, fid, fid, "npub1… or paste", size=12, color=HINT))
    kids.append(make_rect("save", ox + 28, oy + 460, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("savel", ox + 28, oy + 474, 334, 24, fid, fid, "Save contact", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(make_text("cancel", ox + 28, oy + 530, 334, 20, fid, fid, "Cancel", size=12, color=CAPTION, align="center"))
    return fr, kids


def build_nostr_inbox(ox, oy):
    fr = make_frame("09 Nostr inbox", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NOSTR", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            36,
            fid,
            fid,
            "Encrypted payment requests\nBitcoin only · NIP-17 gift wrap",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_rect("new", ox + 28, oy + 186, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("newl", ox + 28, oy + 200, 334, 24, fid, fid, "New request", size=15, color="#000000", weight="700", align="center")
    )
    rows = [
        ("A", "Alice", "in", "21,000 sats · pay?", True),
        ("B", "Bob", "out", "50,000 sats · pending", False),
        ("C", "Carol", "out", "10,000 sats · accepted", False),
        ("D", "Dave", "in", "expired", False),
    ]
    for i, (letter, name, pill, sub, sel) in enumerate(rows):
        yy = oy + 256 + i * 88
        kids += person_row(ox + 28, yy, 334, letter, name, pill, sub, fid, fid, selected=sel, prefix=f"n{i}")
    kids.append(
        make_text("count", ox + 28, oy + 620, 334, 18, fid, fid, f"{len(rows)} requests", size=11, color=HINT, align="center")
    )
    return fr, kids


def build_nostr_compose(ox, oy):
    fr = make_frame("09b Compose request", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NEW REQUEST", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            20,
            fid,
            fid,
            "Ask a contact for a receive address",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids += person_row(
        ox + 28, oy + 172, 334, "A", "Alice", "npub", mid_ellipsis(DEMO_NPUB_ALICE, 10, 6), fid, fid, selected=True, prefix="to"
    )
    kids.append(make_text("la", ox + 28, oy + 272, 120, 18, fid, fid, "amount", size=12, color="#8C8C8C"))
    kids.append(make_rect("fa", ox + 28, oy + 294, 334, 48, fid, fid, rx=10))
    kids.append(make_text("va", ox + 42, oy + 308, 300, 24, fid, fid, "21,000 sats", size=16, weight="700"))
    kids.append(make_text("lm", ox + 28, oy + 362, 120, 18, fid, fid, "memo", size=12, color="#8C8C8C"))
    kids.append(make_rect("fm", ox + 28, oy + 384, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vm", ox + 42, oy + 398, 300, 24, fid, fid, "coffee", size=14))
    kids.append(make_rect("send", ox + 28, oy + 470, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("sendl", ox + 28, oy + 484, 334, 24, fid, fid, "Send request", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 540,
            334,
            40,
            fid,
            fid,
            "Encrypted DM to their npub.\nThey return a fresh address if they accept.",
            size=11,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_nostr_incoming(ox, oy):
    """Incoming request: recipient accepts and returns a receive address."""
    fr = make_frame("09c Incoming pay", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "PAY REQUEST", size=20, weight="700", align="center"))
    kids.append(
        make_text("sub", ox + 40, oy + 132, 310, 20, fid, fid, "From Alice · gift-wrapped", size=12, color=CAPTION, align="center")
    )
    kids += person_row(
        ox + 28, oy + 172, 334, "A", "Alice", "npub", mid_ellipsis(DEMO_NPUB_ALICE, 10, 6), fid, fid, prefix="from"
    )
    kids += value_row(ox + 28, oy + 272, 334, "Amount", "21,000 sats", fid, fid, prefix="amt")
    kids += value_row(ox + 28, oy + 348, 334, "Memo", "coffee", fid, fid, prefix="memo")
    kids += value_row(ox + 28, oy + 424, 334, "Status", "pending", fid, fid, prefix="st")
    kids.append(make_rect("pay", ox + 28, oy + 520, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text(
            "payl",
            ox + 28,
            oy + 534,
            334,
            24,
            fid,
            fid,
            "Accept & share address",
            size=15,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    kids.append(make_rect("rej", ox + 28, oy + 584, 334, 48, fid, fid, rx=10))
    kids.append(make_text("rejl", ox + 28, oy + 598, 334, 24, fid, fid, "Decline", size=14, color=CAPTION, align="center"))
    return fr, kids


def build_nostr_pending(ox, oy):
    fr = make_frame("09d Outgoing pending", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SENT", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            36,
            fid,
            fid,
            "Waiting for Alice to accept\nand return a receive address",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids += person_row(ox + 28, oy + 192, 334, "A", "Alice", "out", "pending", fid, fid, prefix="to")
    kids += value_row(ox + 28, oy + 292, 334, "Amount", "21,000 sats", fid, fid, prefix="amt")
    kids += value_row(ox + 28, oy + 368, 334, "Memo", "coffee", fid, fid, prefix="memo")
    kids += value_row(ox + 28, oy + 444, 334, "Status", "pending", fid, fid, prefix="st")
    kids.append(make_rect("cancel", ox + 28, oy + 540, 334, 48, fid, fid, rx=10))
    kids.append(make_text("cancell", ox + 28, oy + 554, 334, 24, fid, fid, "Cancel request", size=14, color=CAPTION, align="center"))
    return fr, kids


def build_nostr_accepted(ox, oy):
    fr = make_frame("09e Accepted address", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ACCEPTED", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            36,
            fid,
            fid,
            "Alice shared a fresh address.\nConfirm on Send.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids += person_row(ox + 28, oy + 192, 334, "A", "Alice", "out", "accepted", fid, fid, selected=True, prefix="to")
    kids += value_row(ox + 28, oy + 292, 334, "Amount", "21,000 sats", fid, fid, prefix="amt")
    kids += value_row(ox + 28, oy + 368, 334, "Address", mid_ellipsis(DEMO_BC1, 10, 8), fid, fid, prefix="addr")
    kids += value_row(ox + 28, oy + 444, 334, "Memo", "coffee", fid, fid, prefix="memo")
    kids.append(make_rect("go", ox + 28, oy + 540, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("gol", ox + 28, oy + 554, 334, 24, fid, fid, "Continue to Send", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_nostr_declined(ox, oy):
    fr = make_frame("09f Declined / expired", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CLOSED", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            20,
            fid,
            fid,
            "These requests are closed",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    for i, (letter, name, pill, sub) in enumerate(
        [
            ("A", "Alice", "declined", "Mar 12"),
            ("D", "Dave", "expired", "Mar 10"),
            ("B", "Bob", "cancelled", "Mar 8"),
        ]
    ):
        yy = oy + 180 + i * 88
        kids += person_row(ox + 28, yy, 334, letter, name, pill, sub, fid, fid, prefix=f"c{i}")
    kids.append(make_rect("back", ox + 28, oy + 470, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("backl", ox + 28, oy + 484, 334, 24, fid, fid, "Back to inbox", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


# Back-compat alias used by older LAYOUT / scripts
def build_nostr(ox, oy):
    return build_nostr_incoming(ox, oy)


def build_multisig(ox, oy, variant="main"):
    """P2WSH multisig coordinated over Nostr — Contacts-parity chrome."""
    names = {
        "main": "10 Multisig",
        "invite": "10b Multisig invite",
        "pending": "10c Multisig pending",
        "cosign": "10d Multisig cosign",
    }
    fr = make_frame(names[variant], ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)

    if variant == "main":
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "MULTISIG", size=20, weight="700", align="center"))
        kids.append(
            make_text(
                "sub",
                ox + 40,
                oy + 132,
                310,
                20,
                fid,
                fid,
                "2-of-3 vault · Nostr coordinated",
                size=12,
                color=CAPTION,
                align="center",
            )
        )
        kids.append(make_rect("bal", ox + 28, oy + 172, 334, 88, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids.append(make_text("bv", ox + 44, oy + 190, 300, 28, fid, fid, "5,000,000 sats", size=22, weight="700"))
        kids.append(make_text("bs", ox + 44, oy + 226, 300, 20, fid, fid, "requires 2 of 3 signatures", size=12, color=CAPTION))
        kids.append(make_text("cl", ox + 28, oy + 280, 200, 18, fid, fid, "Cosigners", size=12, color="#8C8C8C"))
        for i, (letter, name, pill, sub, sel) in enumerate(
            [
                ("Y", "You", "key", mid_ellipsis(DEMO_NPUB_YOU, 10, 6), True),
                ("A", "Alice", "npub", mid_ellipsis(DEMO_NPUB_ALICE, 10, 6), False),
                ("B", "Bob", "npub", mid_ellipsis(DEMO_NPUB_BOB, 10, 6), False),
            ]
        ):
            yy = oy + 304 + i * 84
            kids += person_row(ox + 28, yy, 334, letter, name, pill, sub, fid, fid, selected=sel, prefix=f"cs{i}")
        kids.append(make_rect("btn", ox + 28, oy + 568, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
        kids.append(
            make_text("bl", ox + 28, oy + 582, 334, 24, fid, fid, "Propose spend", size=15, color="#000000", weight="700", align="center")
        )
        kids += nav_row(ox + 28, oy + 632, 334, "Invite cosigner", fid, fid, prefix="inv")
        kids += nav_row(ox + 28, oy + 700, 334, "Create vault", fid, fid, prefix="crt")
        kids.append(
            make_text("imp", ox + 28, oy + 770, 334, 20, fid, fid, "Import descriptor", size=12, color=CAPTION, align="center")
        )

    elif variant == "invite":
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "INVITE", size=20, weight="700", align="center"))
        kids.append(
            make_text(
                "sub",
                ox + 40,
                oy + 132,
                310,
                36,
                fid,
                fid,
                "Share with a cosigner by npub\nor out-of-band invite code",
                size=12,
                color=CAPTION,
                align="center",
            )
        )
        kids += person_row(
            ox + 28, oy + 188, 334, "A", "Alice", "npub", mid_ellipsis(DEMO_NPUB_ALICE, 10, 6), fid, fid, selected=True, prefix="to"
        )
        kids.append(make_text("lp", ox + 28, oy + 288, 160, 18, fid, fid, "policy", size=12, color="#8C8C8C"))
        kids.append(make_rect("fp", ox + 28, oy + 310, 334, 48, fid, fid, fill="#111111", stroke="#555555", rx=10))
        kids.append(make_text("vp", ox + 42, oy + 324, 300, 24, fid, fid, "2-of-3 · P2WSH", size=14, weight="700"))
        kids.append(make_text("lc", ox + 28, oy + 380, 160, 18, fid, fid, "invite code", size=12, color="#8C8C8C"))
        kids.append(make_rect("code", ox + 28, oy + 402, 334, 72, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=12))
        kids.append(make_text("cv", ox + 44, oy + 428, 300, 24, fid, fid, "basic-ms-7F3A9C", size=16, weight="700", align="center"))
        kids.append(make_rect("btn", ox + 28, oy + 500, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
        kids.append(
            make_text("bl", ox + 28, oy + 514, 334, 24, fid, fid, "Copy invite", size=15, color="#000000", weight="700", align="center")
        )
        kids.append(make_rect("share", ox + 28, oy + 564, 334, 48, fid, fid, rx=10))
        kids.append(make_text("sharel", ox + 28, oy + 578, 334, 24, fid, fid, "Share over Nostr", size=14, align="center"))
        kids.append(
            make_text(
                "hint",
                ox + 28,
                oy + 640,
                334,
                40,
                fid,
                fid,
                "No coordinator server.\nKeys stay on each device.",
                size=11,
                color=HINT,
                align="center",
            )
        )

    elif variant == "pending":
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "PENDING", size=20, weight="700", align="center"))
        kids.append(
            make_text(
                "sub",
                ox + 40,
                oy + 132,
                310,
                20,
                fid,
                fid,
                "Waiting for cosigner signatures",
                size=12,
                color=CAPTION,
                align="center",
            )
        )
        kids += value_row(ox + 28, oy + 172, 334, "Proposal", "100,000 sats", fid, fid, prefix="prop")
        kids += value_row(ox + 28, oy + 248, 334, "To", mid_ellipsis(DEMO_BC1, 10, 8), fid, fid, prefix="to")
        kids.append(make_text("cl", ox + 28, oy + 332, 200, 18, fid, fid, "Signatures", size=12, color="#8C8C8C"))
        for i, (letter, name, pill, sub, sel) in enumerate(
            [
                ("Y", "You", "signed", mid_ellipsis(DEMO_NPUB_YOU, 8, 6), True),
                ("A", "Alice", "waiting", mid_ellipsis(DEMO_NPUB_ALICE, 8, 6), False),
                ("B", "Bob", "waiting", mid_ellipsis(DEMO_NPUB_BOB, 8, 6), False),
            ]
        ):
            yy = oy + 356 + i * 84
            kids += person_row(ox + 28, yy, 334, letter, name, pill, sub, fid, fid, selected=sel, prefix=f"sg{i}")
        kids.append(
            make_text("prog", ox + 28, oy + 620, 334, 18, fid, fid, "1 of 2 signatures collected", size=11, color=HINT, align="center")
        )
        kids.append(make_rect("cancel", ox + 28, oy + 660, 334, 48, fid, fid, rx=10))
        kids.append(make_text("cancell", ox + 28, oy + 674, 334, 24, fid, fid, "Cancel proposal", size=14, color=CAPTION, align="center"))

    else:  # cosign
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "COSIGN", size=20, weight="700", align="center"))
        kids.append(
            make_text(
                "sub",
                ox + 40,
                oy + 132,
                310,
                20,
                fid,
                fid,
                "Review and sign this proposal",
                size=12,
                color=CAPTION,
                align="center",
            )
        )
        kids += person_row(
            ox + 28, oy + 172, 334, "Y", "You", "key", mid_ellipsis(DEMO_NPUB_YOU, 10, 6), fid, fid, selected=True, prefix="me"
        )
        kids += value_row(ox + 28, oy + 272, 334, "Send", "100,000 sats", fid, fid, prefix="amt")
        kids += value_row(ox + 28, oy + 348, 334, "To", mid_ellipsis(DEMO_BC1, 10, 8), fid, fid, prefix="dest")
        kids += value_row(ox + 28, oy + 424, 334, "Network fee", "~420 sats", fid, fid, prefix="fee")
        kids += value_row(ox + 28, oy + 500, 334, "Policy", "2-of-3 · your signature needed", fid, fid, prefix="pol")
        kids += elastic_slider(ox + 28, oy + 600, fid, fid, progress=0.35, label="slide to cosign", label_color="#FFFFFF")
        kids.append(
            make_text(
                "hint",
                ox + 28,
                oy + 670,
                334,
                40,
                fid,
                fid,
                "If a hardware wallet is paired,\nconfirm there instead.",
                size=11,
                color=HINT,
                align="center",
            )
        )

    return fr, kids


def build_create_vault(ox, oy):
    fr = make_frame("10e Create vault", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CREATE VAULT", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            36,
            fid,
            fid,
            "In-app keys only.\nInvite cosigners after creation.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("lp", ox + 28, oy + 190, 160, 18, fid, fid, "policy", size=12, color="#8C8C8C"))
    kids.append(make_rect("fp", ox + 28, oy + 212, 334, 48, fid, fid, fill="#111111", stroke="#555555", rx=10))
    kids.append(make_text("vp", ox + 42, oy + 226, 300, 24, fid, fid, "2-of-3 · P2WSH", size=14, weight="700"))
    kids.append(make_text("ln", ox + 28, oy + 280, 160, 18, fid, fid, "label", size=12, color="#8C8C8C"))
    kids.append(make_rect("fn", ox + 28, oy + 302, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vn", ox + 42, oy + 316, 300, 24, fid, fid, "Family vault", size=14))
    kids += value_row(ox + 28, oy + 380, 334, "Your key", "Generated in-app", fid, fid, prefix="k")
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 470,
            334,
            40,
            fid,
            fid,
            "No pasted xpubs at creation.\nImport descriptor is for recovery only.",
            size=11,
            color=HINT,
            align="center",
        )
    )
    kids.append(make_rect("cta", ox + 28, oy + 540, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 554, 334, 24, fid, fid, "Create vault", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_import_descriptor(ox, oy):
    fr = make_frame("10f Import descriptor", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "IMPORT", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            36,
            fid,
            fid,
            "Recovery path.\nPaste output descriptor or BSMS.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("ld", ox + 28, oy + 190, 200, 18, fid, fid, "descriptor / BSMS", size=12, color="#8C8C8C"))
    kids.append(make_rect("fd", ox + 28, oy + 212, 334, 140, fid, fid, fill="#111111", stroke="#555555", rx=10))
    kids.append(
        make_text(
            "vd",
            ox + 42,
            oy + 230,
            306,
            100,
            fid,
            fid,
            "wsh(sortedmulti(2,…))\nor paste BSMS package",
            size=12,
            color=HINT,
        )
    )
    kids.append(make_rect("cta", ox + 28, oy + 390, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 404, 334, 24, fid, fid, "Import vault", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 460,
            334,
            40,
            fid,
            fid,
            "Prefer Create vault + invite\nfor new setups.",
            size=11,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_onboarding(ox, oy):
    fr = make_frame("11 Onboarding Create", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 120, oy + 180, fid, fid, 1.1)
    # Match Expo OnboardingCreateScreen caption + CTAs
    tag = shape("text", "tag", ox + 40, oy + 300, 310, 72, fid, fid)
    tag["grow-type"] = "fixed"
    tag_line = {
        "line-height": "1.35",
        "font-style": "normal",
        "text-align": "center",
        "font-size": "14",
        "font-weight": "400",
        "font-family": "JetBrains Mono",
        "font-id": "gfont-jetbrains-mono",
        "font-variant": "normal",
        "text-decoration": "none",
        "text-transform": "none",
        "fills": [{"fill-color": CAPTION, "fill-opacity": 1}],
    }
    tag["content"] = {
        "type": "root",
        "vertical-align": "top",
        "children": [
            {
                "type": "paragraph-set",
                "children": [
                    {
                        "type": "paragraph",
                        "text-align": "center",
                        "children": [{**tag_line, "text": "Your payments app."}],
                    },
                    {
                        "type": "paragraph",
                        "text-align": "center",
                        "children": [{**tag_line, "text": "No seed phrase in setup."}],
                    },
                    {
                        "type": "paragraph",
                        "text-align": "center",
                        "children": [{**tag_line, "text": "OS passkey + multi-cloud backups."}],
                    },
                ],
            }
        ],
    }
    kids.append(tag)
    kids.append(make_rect("b1", ox + 28, oy + 400, 334, 52, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text(
            "b1l",
            ox + 28,
            oy + 414,
            334,
            24,
            fid,
            fid,
            "Continue",
            size=16,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    # Text link under Continue (same style as restore footer — not a button)
    kids.append(
        make_text(
            "b2l",
            ox + 28,
            oy + 468,
            334,
            24,
            fid,
            fid,
            "Continue without passkey",
            size=14,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(
        make_text(
            "restore",
            ox + 28,
            oy + 780,
            334,
            24,
            fid,
            fid,
            "Seed phrase or nsec? Restore here.",
            size=14,
            color=CAPTION,
            align="center",
        )
    )
    return fr, kids


TERMS_OF_USE_BODY = (
    "You alone control your keys and backups.\n"
    "If you lose them with no backup, your bitcoin is gone.\n\n"
    "Imported wallets are not automatically synced. Set up a Nostr or Home Server backup sync.\n\n"
    "Basic is zero-knowledge:\n"
    "• We cannot see your balances or transactions\n"
    "• We cannot move, freeze, or recover your funds\n"
    "• We cannot reset a lost passkey or passphrase\n"
    "• We never store your seed or mnemonic"
)


def build_terms_of_use(ox, oy, variant="passkey"):
    """Terms of Use after Create — passkey = cross-device only; else device-only."""
    is_passkey = variant == "passkey"
    name = "11b Terms of Use (passkey)" if is_passkey else "11b2 Terms of Use (device only)"
    fr = make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "TERMS OF USE", size=20, weight="700", align="center")
    )
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 136,
            310,
            40,
            fid,
            fid,
            (
                "Passkey syncs across your devices.\nRead before you continue."
                if is_passkey
                else "This wallet stays on this device unless\nyou add another backup."
            ),
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    if is_passkey:
        kids.append(make_rect("ok", ox + 28, oy + 196, 334, 100, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=12))
        kids.append(make_text("ok-t", ox + 44, oy + 214, 300, 24, fid, fid, "Across your devices", size=16, weight="700"))
        kids.append(
            make_text(
                "ok-d",
                ox + 44,
                oy + 246,
                300,
                40,
                fid,
                fid,
                "iCloud Keychain, Google Password\nManager, or 3rd party password manager.",
                size=13,
                color=CAPTION,
            )
        )
        terms_y = 320
    else:
        kids.append(make_rect("warn", ox + 28, oy + 196, 334, 100, fid, fid, fill="#0D0D0D", stroke="#555555", rx=12))
        kids.append(make_text("w-t", ox + 44, oy + 214, 300, 24, fid, fid, "This device only", size=16, weight="700"))
        kids.append(
            make_text(
                "w-d",
                ox + 44,
                oy + 246,
                300,
                40,
                fid,
                fid,
                "Dies with the phone. Enable cloud sync\nor export 24 words / Nostr package.",
                size=13,
                color=CAPTION,
            )
        )
        terms_y = 320

    kids.append(
        make_text(
            "terms-h",
            ox + 28,
            oy + terms_y,
            334,
            20,
            fid,
            fid,
            "Your responsibilities",
            size=14,
            weight="700",
            align="center",
        )
    )
    kids.append(
        make_text(
            "terms",
            ox + 28,
            oy + terms_y + 28,
            334,
            200,
            fid,
            fid,
            TERMS_OF_USE_BODY,
            size=12,
            color=CAPTION,
            align="left",
        )
    )
    cta_y = terms_y + 250
    kids.append(make_rect("cta", ox + 28, oy + cta_y, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text(
            "ctal",
            ox + 28,
            oy + cta_y + 14,
            334,
            24,
            fid,
            fid,
            "I understand · Continue",
            size=15,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    if not is_passkey:
        kids.append(
            make_text(
                "hint",
                ox + 28,
                oy + cta_y + 60,
                334,
                40,
                fid,
                fid,
                "Never mark “safe” without another\nbackup path (Nostr / home server / 24 words).",
                size=12,
                color=HINT,
                align="center",
            )
        )
    return fr, kids


def build_passkey_sync(ox, oy):
    """Deprecated alias — passkey Terms of Use (cross-device)."""
    return build_terms_of_use(ox, oy, variant="passkey")


RESTORE_CAPTION = (
    "Restore won't use Passkey.\n"
    "Seed = single wallet.\n"
    "nsec / home server = encrypted package\n"
    "(multiple wallets)."
)
PASSKEY_MISSING_CAPTION = (
    "Continue with passkey found no match.\n"
    "A new passkey = a different wallet.\n"
    "Restore below, or try another account."
)
# Always shown on Nostr / home package + passphrase screens
PASSPHRASE_LOSS_CAPTION = (
    "Lose this passphrase = lose wallet access.\n"
    "Save it offline. Basic cannot recover it."
)


def build_passkey_not_found(ox, oy):
    """Arrive here when Continue with passkey finds no matching passkey."""
    return build_restore(ox, oy, mode="seed", context="passkey_missing")


def build_create_without_passkey(ox, oy):
    """CSPRNG + motion — ONLY when adding an extra wallet without passkey (not onboarding)."""
    fr = make_frame("14b Create without passkey", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ADD ENTROPY", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            56,
            fid,
            fid,
            "Move your finger or tilt the device\nto mix entropy into a new wallet seed.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    # Motion pad
    kids.append(make_rect("pad", ox + 28, oy + 230, 334, 280, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=16))
    kids.append(make_text("pad-l", ox + 28, oy + 340, 334, 28, fid, fid, "Draw / tilt here", size=14, color=CAPTION, align="center"))
    kids.append(make_text("prog", ox + 28, oy + 530, 334, 20, fid, fid, "entropy  ▓▓▓▓▓▓▓▓░░  78%", size=13, color=CAPTION, align="center"))
    kids.append(make_rect("cta", ox + 28, oy + 580, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 594, 334, 24, fid, fid, "Continue to name wallet", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_export_recovery_phrase(ox, oy):
    """Optional 24-word export after passkey auth — Settings only, NEVER onboarding."""
    fr = make_frame("11e Export recovery phrase", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECOVERY PHRASE", size=18, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            40,
            fid,
            fid,
            "24 words · write offline.\nShown only after passkey / PIN.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_rect("box", ox + 28, oy + 200, 334, 280, fid, fid, fill="#1A1A1A", stroke="#FFFFFF", rx=12))
    kids.append(
        make_text(
            "words",
            ox + 44,
            oy + 220,
            300,
            240,
            fid,
            fid,
            "1 abandon  2 ability  3 able\n4 about  5 above  6 absent\n7 absorb  8 abstract  9 absurd\n"
            "10 abuse  11 access  12 accident\n13 account  14 accuse  15 achieve\n"
            "16 acid  17 acoustic  18 acquire\n19 across  20 act  21 action\n22 actor  23 actress  24 actual",
            size=11,
        )
    )
    kids.append(make_rect("done", ox + 28, oy + 520, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("donel", ox + 28, oy + 534, 334, 24, fid, fid, "I wrote it down", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(
        make_text("hint", ox + 28, oy + 590, 334, 40, fid, fid, "Required safety net if passkey is\ndevice-only or cross-OS fails.", size=12, color=HINT, align="center")
    )
    return fr, kids


def build_backup(ox, oy):
    """Opt-in encrypted backups (Nostr / home server) — NOT seed reveal."""
    fr = make_frame("12 Advanced Backup", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ADVANCED BACKUP", size=20, weight="700", align="center")
    )
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 145,
            310,
            56,
            fid,
            fid,
            "Encrypted backups instead of\nOS passkey. Opens when you choose\nContinue without passkey.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    # Option 1: Nostr
    kids.append(make_rect("opt-nostr", ox + 28, oy + 240, 334, 140, fid, fid, fill="#141414", stroke="#FFFFFF", rx=12))
    kids.append(make_text("n-t", ox + 44, oy + 258, 260, 24, fid, fid, "Nostr relays", size=16, weight="700"))
    kids.append(make_text("n-ch", ox + 300, oy + 258, 40, 24, fid, fid, "›", size=20, color="#8C8C8C", align="right"))
    kids.append(
        make_text(
            "n-d",
            ox + 44,
            oy + 290,
            300,
            70,
            fid,
            fid,
            "Encrypted backup over Nostr.\nPassphrase required — save offline.",
            size=13,
            color=CAPTION,
        )
    )
    # Option 2: Home server
    kids.append(make_rect("opt-home", ox + 28, oy + 400, 334, 140, fid, fid, fill="#141414", stroke="#FFFFFF", rx=12))
    kids.append(make_text("h-t", ox + 44, oy + 418, 260, 24, fid, fid, "Home server", size=16, weight="700"))
    kids.append(make_text("h-ch", ox + 300, oy + 418, 40, 24, fid, fid, "›", size=20, color="#8C8C8C", align="right"))
    kids.append(
        make_text(
            "h-d",
            ox + 44,
            oy + 450,
            300,
            70,
            fid,
            fid,
            "Encrypted backup to your server.\nPassphrase required — save offline.",
            size=13,
            color=CAPTION,
        )
    )
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 580,
            334,
            56,
            fid,
            fid,
            PASSPHRASE_LOSS_CAPTION,
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_nostr_backup(ox, oy):
    """Encrypted multi-wallet package on Nostr — ALWAYS requires wrapping passphrase."""
    fr = make_frame("12d Nostr backup", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NOSTR BACKUP", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 138,
            310,
            48,
            fid,
            fid,
            "AEAD package of ALL wallets.\nPassphrase required.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("rl", ox + 28, oy + 200, 200, 18, fid, fid, "relays", size=12, color="#8C8C8C"))
    for i, url in enumerate(["wss://relay.damus.io", "wss://nos.lol"]):
        yy = oy + 222 + i * 64
        kids += value_row(ox + 28, yy, 334, url, "ON", fid, fid, prefix=f"r{i}")
    kids.append(make_text("pl", ox + 28, oy + 360, 200, 18, fid, fid, "backup passphrase", size=12, color="#8C8C8C"))
    kids.append(make_rect("fp", ox + 28, oy + 382, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vp", ox + 42, oy + 396, 300, 24, fid, fid, "••••••••••••", size=16))
    kids.append(make_text("cl", ox + 28, oy + 448, 200, 18, fid, fid, "confirm passphrase", size=12, color="#8C8C8C"))
    kids.append(make_rect("fc", ox + 28, oy + 470, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vc", ox + 42, oy + 484, 300, 24, fid, fid, "••••••••••••", size=16))
    kids.append(
        make_text(
            "note",
            ox + 28,
            oy + 530,
            334,
            48,
            fid,
            fid,
            PASSPHRASE_LOSS_CAPTION,
            size=12,
            color=HINT,
            align="center",
        )
    )
    kids.append(make_rect("cta", ox + 28, oy + 600, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 614, 334, 24, fid, fid, "Enable Nostr backup", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_home_server_backup(ox, oy):
    """Home server ciphertext — ALWAYS requires wrapping passphrase."""
    fr = make_frame("12e Home server backup", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "HOME SERVER", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 138,
            310,
            36,
            fid,
            fid,
            "Same encrypted package as Nostr.\nPassphrase required.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("lu", ox + 28, oy + 200, 120, 18, fid, fid, "server URL", size=12, color="#8C8C8C"))
    kids.append(make_rect("fu", ox + 28, oy + 222, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vu", ox + 44, oy + 236, 300, 24, fid, fid, "https://backup.home.lan", size=13, color="#8C8C8C"))
    kids.append(make_text("lt", ox + 28, oy + 288, 160, 18, fid, fid, "access token", size=12, color="#8C8C8C"))
    kids.append(make_rect("ft", ox + 28, oy + 310, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vt", ox + 44, oy + 324, 300, 24, fid, fid, "optional", size=13, color="#595959"))
    kids.append(make_text("pl", ox + 28, oy + 376, 200, 18, fid, fid, "backup passphrase", size=12, color="#8C8C8C"))
    kids.append(make_rect("fp", ox + 28, oy + 398, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vp", ox + 42, oy + 412, 300, 24, fid, fid, "••••••••••••", size=16))
    kids.append(make_rect("test", ox + 28, oy + 470, 334, 48, fid, fid, rx=10))
    kids.append(make_text("testl", ox + 28, oy + 484, 334, 24, fid, fid, "Test connection", size=14, align="center"))
    kids.append(
        make_text(
            "note",
            ox + 28,
            oy + 540,
            334,
            40,
            fid,
            fid,
            PASSPHRASE_LOSS_CAPTION,
            size=12,
            color=HINT,
            align="center",
        )
    )
    kids.append(make_rect("cta", ox + 28, oy + 600, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 614, 334, 24, fid, fid, "Enable home backup", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_import_nsec_gate(ox, oy):
    """Warning gate before importing an external Nostr identity."""
    fr = make_frame("12f Import nsec warning", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "IMPORT NSEC", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 145,
            310,
            72,
            fid,
            fid,
            "Advanced path.\nYou may reuse a social nsec.\nA backup passphrase is always required.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    # Warning list — one card, not button-like rows
    card_x, card_y, card_w, card_h = ox + 28, oy + 232, 334, 188
    kids.append(make_rect("warn-card", card_x, card_y, card_w, card_h, fid, fid, fill="#141414", stroke="#333333", rx=12))
    items = [
        ("nsec unlocks the encrypted package", 28),
        ("Passphrase ALWAYS required", 28),
        ("Clipboard / screenshot risk on paste", 28),
        ("You can reuse your social nsec,\nbut you will be required to add a passphrase.", 44),
    ]
    yy = card_y + 16
    for i, (line, h) in enumerate(items):
        kids.append(make_text(f"dot{i}", card_x + 20, yy, 20, 22, fid, fid, "·", size=16, color=CAPTION))
        kids.append(make_text(f"wl{i}", card_x + 44, yy, card_w - 64, h, fid, fid, line, size=13, color=CAPTION))
        yy += h + 8
    kids.append(make_rect("go", ox + 28, oy + 460, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("gol", ox + 28, oy + 474, 334, 24, fid, fid, "I understand · Continue", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(make_rect("back", ox + 28, oy + 524, 334, 48, fid, fid, rx=10))
    kids.append(
        make_text("backl", ox + 28, oy + 538, 334, 24, fid, fid, "Generate new identity instead", size=14, color="#8C8C8C", align="center")
    )
    return fr, kids


def build_restore(ox, oy, *, mode="seed", context="restore"):
    """Restore hub Seed | nsec | Server.

    context=restore → from «No passkey? Restore here.»
    context=passkey_missing → from Continue with passkey with no match (11c).
    """
    missing = context == "passkey_missing"
    if missing:
        name = "11c Passkey not found"
        title = "PASSKEY MISSING"
        caption = PASSKEY_MISSING_CAPTION
    else:
        name = {
            "seed": "12b Restore seed",
            "nsec": "12c Restore nsec",
            "server": "12h Restore home server",
        }[mode]
        title = "RESTORE"
        caption = RESTORE_CAPTION

    fr = make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, title, size=18 if missing else 20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            72,
            fid,
            fid,
            caption,
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    # 3-way segment
    seg_y = 220
    kids.append(make_rect("seg", ox + 28, oy + seg_y, 334, 44, fid, fid, fill="#141414", stroke="#555555", rx=10))
    tabs = [("seed", "Seed", 28), ("nsec", "nsec", 139), ("server", "Server", 250)]
    for key, lab, xoff in tabs:
        on = mode == key
        if on:
            kids.append(make_rect(f"seg-{key}", ox + xoff + 4, oy + seg_y + 4, 106, 36, fid, fid, fill="#FFFFFF", stroke=None, rx=8))
        kids.append(
            make_text(
                f"st-{key}",
                ox + xoff + 4,
                oy + seg_y + 12,
                106,
                22,
                fid,
                fid,
                lab,
                size=12,
                color="#000000" if on else CAPTION,
                weight="700" if on else "400",
                align="center",
            )
        )

    body_y = seg_y + 65  # 285
    if mode == "seed":
        kids.append(make_rect("box", ox + 28, oy + body_y, 334, 120, fid, fid, fill="#1A1A1A", stroke="#FFFFFF", rx=12))
        kids.append(
            make_text(
                "words",
                ox + 44,
                oy + body_y + 14,
                300,
                96,
                fid,
                fid,
                "24 words (BIP39)\nabandon ability able about\nabove absent absorb abstract\n… actor actress actual",
                size=13,
            )
        )
        kids.append(make_text("pp", ox + 28, oy + body_y + 135, 200, 18, fid, fid, "BIP39 passphrase", size=12, color="#8C8C8C"))
        kids.append(make_rect("fpp", ox + 28, oy + body_y + 157, 334, 48, fid, fid, rx=10))
        kids.append(make_text("vpp", ox + 42, oy + body_y + 171, 300, 24, fid, fid, "optional", size=13, color="#595959"))
        cta = "Restore wallet"
        cta_y = body_y + 225
    elif mode == "nsec":
        kids.append(make_text("nl", ox + 28, oy + body_y, 120, 18, fid, fid, "nsec", size=12, color="#8C8C8C"))
        kids.append(make_rect("fn", ox + 28, oy + body_y + 22, 334, 48, fid, fid, rx=10))
        kids.append(make_text("vn", ox + 42, oy + body_y + 36, 300, 24, fid, fid, mid_ellipsis(DEMO_NSEC, 10, 6), size=13))
        kids.append(make_text("pl", ox + 28, oy + body_y + 90, 220, 18, fid, fid, "backup passphrase · required", size=12, color="#8C8C8C"))
        kids.append(make_rect("fp", ox + 28, oy + body_y + 112, 334, 48, fid, fid, rx=10))
        kids.append(make_text("vp", ox + 42, oy + body_y + 126, 300, 24, fid, fid, "••••••••••••", size=16))
        kids.append(
            make_text(
                "warn",
                ox + 28,
                oy + body_y + 175,
                334,
                48,
                fid,
                fid,
                PASSPHRASE_LOSS_CAPTION,
                size=12,
                color=HINT,
                align="center",
            )
        )
        cta = "Restore wallets"
        cta_y = body_y + 240
    else:
        kids.append(make_text("lu", ox + 28, oy + body_y, 160, 18, fid, fid, "server URL", size=12, color="#8C8C8C"))
        kids.append(make_rect("fu", ox + 28, oy + body_y + 22, 334, 48, fid, fid, rx=10))
        kids.append(make_text("vu", ox + 42, oy + body_y + 36, 300, 24, fid, fid, "https://backup.home.lan", size=13, color="#8C8C8C"))
        kids.append(make_text("lt", ox + 28, oy + body_y + 90, 160, 18, fid, fid, "access token", size=12, color="#8C8C8C"))
        kids.append(make_rect("ft", ox + 28, oy + body_y + 112, 334, 48, fid, fid, rx=10))
        kids.append(make_text("vt", ox + 42, oy + body_y + 126, 300, 24, fid, fid, "optional", size=13, color="#595959"))
        kids.append(make_text("pl", ox + 28, oy + body_y + 180, 220, 18, fid, fid, "backup passphrase · required", size=12, color="#8C8C8C"))
        kids.append(make_rect("fp", ox + 28, oy + body_y + 202, 334, 48, fid, fid, rx=10))
        kids.append(make_text("vp", ox + 42, oy + body_y + 216, 300, 24, fid, fid, "••••••••••••", size=16))
        kids.append(
            make_text(
                "warn",
                ox + 28,
                oy + body_y + 268,
                334,
                40,
                fid,
                fid,
                PASSPHRASE_LOSS_CAPTION,
                size=12,
                color=HINT,
                align="center",
            )
        )
        cta = "Restore from server"
        cta_y = body_y + 325

    kids.append(make_rect("cta", ox + 28, oy + cta_y, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + cta_y + 14, 334, 24, fid, fid, cta, size=15, color="#000000", weight="700", align="center")
    )

    if missing:
        kids.append(
            make_text(
                "other",
                ox + 28,
                oy + cta_y + 68,
                334,
                22,
                fid,
                fid,
                "Try another Apple / Google account",
                size=13,
                color=CAPTION,
                align="center",
            )
        )
        kids.append(
            make_text(
                "new",
                ox + 28,
                oy + cta_y + 98,
                334,
                22,
                fid,
                fid,
                "Create NEW wallet (I understand)",
                size=13,
                color=CAPTION,
                align="center",
            )
        )

    return fr, kids


def build_add_wallet(ox, oy):
    """Add an extra wallet — passkey users derive; non-passkey use motion entropy."""
    fr = make_frame("14 Add wallet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ADD WALLET", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            48,
            fid,
            fid,
            "Choose how to create this wallet.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_rect("a", ox + 28, oy + 220, 334, 110, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=12))
    kids.append(make_text("at", ox + 44, oy + 240, 300, 24, fid, fid, "With passkey", size=16, weight="700"))
    kids.append(
        make_text("ad", ox + 44, oy + 274, 300, 40, fid, fid, "Derive a new labeled wallet\nfrom your passkey.", size=13, color=CAPTION)
    )
    kids.append(make_rect("b", ox + 28, oy + 350, 334, 110, fid, fid, fill="#0D0D0D", stroke="#555555", rx=12))
    kids.append(make_text("bt", ox + 44, oy + 370, 300, 24, fid, fid, "Without passkey", size=16, weight="700"))
    kids.append(
        make_text(
            "bd",
            ox + 44,
            oy + 404,
            300,
            40,
            fid,
            fid,
            "Create with finger / device motion,\nthen name the wallet.",
            size=13,
            color=CAPTION,
        )
    )
    return fr, kids


def build_name_new_wallet(ox, oy):
    fr = make_frame("14c Name new wallet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NAME WALLET", size=20, weight="700", align="center"))
    kids.append(make_text("sub", ox + 40, oy + 145, 310, 20, fid, fid, "Give this wallet a name", size=13, color=CAPTION, align="center"))
    kids.append(make_text("ln", ox + 28, oy + 220, 120, 18, fid, fid, "label", size=12, color="#8C8C8C"))
    kids.append(make_rect("fn", ox + 28, oy + 242, 334, 48, fid, fid, rx=10))
    kids.append(make_text("vn", ox + 42, oy + 256, 300, 24, fid, fid, "Travel", size=16, weight="700"))
    kids.append(make_rect("cta", ox + 28, oy + 340, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("ctal", ox + 28, oy + 354, 334, 24, fid, fid, "Create wallet", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids



def build_settings_nostr(ox, oy):
    """Nostr identity: social profile + backup package + nsec import/export."""
    fr = make_frame("05d Nostr identity", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NOSTR", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            32,
            fid,
            fid,
            "Social identity, payments,\nand encrypted multi-wallet backup.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    # Profile (npub + kind 0 fields useful for social)
    kids += value_row(ox + 28, oy + 172, 334, "npub", mid_ellipsis(DEMO_NPUB_BASIC, 10, 6), fid, fid, prefix="np")
    kids += value_row(ox + 28, oy + 244, 334, "NIP-05", "you@basic.wallet", fid, fid, prefix="n5")
    kids += value_row(ox + 28, oy + 316, 334, "Display name", "Basic", fid, fid, prefix="dn")
    kids += value_row(ox + 28, oy + 388, 334, "Lightning address", "you@basic.wallet", fid, fid, prefix="ln")
    kids += value_row(ox + 28, oy + 460, 334, "About", "Payments over Nostr", fid, fid, prefix="ab")
    # Keys / backup
    kids += nav_row(ox + 28, oy + 540, 334, "Export nsec", fid, fid, prefix="ex")
    kids += nav_row(ox + 28, oy + 604, 334, "Import nsec", fid, fid, prefix="im")
    kids += nav_row(ox + 28, oy + 668, 334, "Encrypted backup", fid, fid, value="On", prefix="nb")
    kids.append(make_rect("copy", ox + 28, oy + 744, 334, 48, fid, fid, rx=10))
    kids.append(make_text("copyl", ox + 28, oy + 758, 334, 24, fid, fid, "Copy npub", size=14, align="center"))
    kids.append(
        make_text(
            "gen",
            ox + 28,
            oy + 804,
            334,
            20,
            fid,
            fid,
            "Generate new identity",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    return fr, kids


def build_settings_passkey(ox, oy):
    """Passkey sync status + export phrase."""
    fr = make_frame("05h Passkey status", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "PASSKEY", size=20, weight="700", align="center"))
    kids += value_row(ox + 28, oy + 170, 334, "Sync", "Across devices", fid, fid, prefix="s0")
    kids += value_row(ox + 28, oy + 246, 334, "Authenticator", "iCloud / Google / password manager", fid, fid, prefix="s1")
    kids += nav_row(ox + 28, oy + 330, 334, "Export recovery phrase", fid, fid, prefix="n0")
    kids += nav_row(ox + 28, oy + 400, 334, "Backup options", fid, fid, prefix="n1")
    return fr, kids


def build_settings_backup_hub(ox, oy):
    """Backup hub aligned with onboarding Paths A/C."""
    fr = make_frame("05e Backup", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "BACKUP", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            36,
            fid,
            fid,
            "Passkey by default.\nEncrypted package for cross-OS restore.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    # Status + nav (tappable rows)
    kids += value_row(ox + 28, oy + 200, 334, "Passkey / OS cloud", "Across devices", fid, fid, prefix="b0")
    kids += nav_row(ox + 28, oy + 280, 334, "Export recovery phrase", fid, fid, prefix="b1")
    kids += nav_row(ox + 28, oy + 350, 334, "Nostr package + passphrase", fid, fid, value="On", prefix="b2")
    kids += nav_row(ox + 28, oy + 420, 334, "Home server + passphrase", fid, fid, value="Off", prefix="b3")
    kids += nav_row(ox + 28, oy + 490, 334, "Restore wallet", fid, fid, prefix="b4")
    kids.append(
        make_text(
            "warn",
            ox + 28,
            oy + 570,
            334,
            40,
            fid,
            fid,
            "Lose the backup passphrase and you lose\naccess to the encrypted package.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_duress_setup(ox, oy):
    fr = make_frame("05g Duress PIN", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "DURESS PIN", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 140,
            310,
            48,
            fid,
            fid,
            "Second PIN opens decoy wallet.\nMust differ from normal PIN.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(make_text("l1", ox + 28, oy + 220, 200, 18, fid, fid, "duress PIN", size=12, color=CAPTION))
    kids.append(make_rect("f1", ox + 28, oy + 242, 334, 48, fid, fid, rx=10))
    kids.append(make_text("v1", ox + 42, oy + 256, 300, 24, fid, fid, "••••••", size=18))
    kids.append(make_text("l2", ox + 28, oy + 310, 200, 18, fid, fid, "confirm", size=12, color=CAPTION))
    kids.append(make_rect("f2", ox + 28, oy + 332, 334, 48, fid, fid, rx=10))
    kids.append(make_text("v2", ox + 42, oy + 346, 300, 24, fid, fid, "••••••", size=18))
    kids.append(make_rect("save", ox + 28, oy + 420, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("savel", ox + 28, oy + 434, 334, 24, fid, fid, "Enable Duress PIN", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_settings_simple(ox, oy, name, title, rows):
    fr = make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, title, size=20, weight="700", align="center"))
    for i, (k, v) in enumerate(rows):
        yy = oy + 170 + i * 76
        kids += value_row(ox + 28, yy, 334, k, v, fid, fid, prefix=f"v{i}")
    return fr, kids


def build_export_nsec_warning(ox, oy):
    fr = make_frame("05i Export nsec warning", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "EXPORT NSEC", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 145,
            310,
            56,
            fid,
            fid,
            "Anyone with this secret can spend\nand decrypt your backup package.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    card_x, card_y, card_w = ox + 28, oy + 230, 334
    kids.append(make_rect("warn-card", card_x, card_y, card_w, 160, fid, fid, fill="#141414", stroke="#333333", rx=12))
    for i, line in enumerate(
        [
            "Screenshots blocked on next screen",
            "Prefer offline / air-gapped copy",
            "Never paste into chat or email",
        ]
    ):
        yy = card_y + 20 + i * 44
        kids.append(make_text(f"dot{i}", card_x + 20, yy, 20, 22, fid, fid, "·", size=16, color=CAPTION))
        kids.append(make_text(f"wl{i}", card_x + 44, yy, card_w - 64, 28, fid, fid, line, size=13, color=CAPTION))
    kids.append(make_rect("go", ox + 28, oy + 440, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("gol", ox + 28, oy + 454, 334, 24, fid, fid, "I understand · Show nsec", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(make_text("cancel", ox + 28, oy + 510, 334, 20, fid, fid, "Cancel", size=12, color=CAPTION, align="center"))
    return fr, kids


def build_export_nsec_reveal(ox, oy):
    fr = make_frame("05j Export nsec reveal", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "YOUR NSEC", size=20, weight="700", align="center"))
    kids.append(
        make_text("sub", ox + 40, oy + 140, 310, 20, fid, fid, "Write it down · then leave this screen", size=12, color=CAPTION, align="center")
    )
    kids.append(make_rect("box", ox + 28, oy + 190, 334, 120, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=12))
    kids.append(
        make_text(
            "nsec",
            ox + 44,
            oy + 220,
            302,
            60,
            fid,
            fid,
            mid_ellipsis(DEMO_NSEC, 12, 10),
            size=13,
            weight="700",
            align="center",
        )
    )
    kids.append(make_rect("copy", ox + 28, oy + 340, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("copyl", ox + 28, oy + 354, 334, 24, fid, fid, "Copy nsec", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(make_rect("done", ox + 28, oy + 404, 334, 48, fid, fid, rx=10))
    kids.append(make_text("donel", ox + 28, oy + 418, 334, 24, fid, fid, "Done", size=14, color=CAPTION, align="center"))
    kids.append(
        make_text(
            "hint",
            ox + 28,
            oy + 480,
            334,
            40,
            fid,
            fid,
            "Clipboard cleared when you leave.",
            size=11,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_generate_identity_warning(ox, oy):
    fr = make_frame("05k Generate identity warning", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NEW IDENTITY", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 145,
            310,
            56,
            fid,
            fid,
            "Creates a new npub / nsec.\nOld social identity is not deleted elsewhere.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids += value_row(ox + 28, oy + 230, 334, "Current npub", mid_ellipsis(DEMO_NPUB_BASIC, 10, 6), fid, fid, prefix="cur")
    kids.append(
        make_text(
            "warn",
            ox + 28,
            oy + 320,
            334,
            56,
            fid,
            fid,
            "Backup package must be re-wrapped.\nContacts still point at the old npub until updated.",
            size=12,
            color=HINT,
            align="center",
        )
    )
    kids.append(make_rect("go", ox + 28, oy + 420, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        make_text("gol", ox + 28, oy + 434, 334, 24, fid, fid, "Generate new identity", size=15, color="#000000", weight="700", align="center")
    )
    kids.append(make_text("cancel", ox + 28, oy + 490, 334, 20, fid, fid, "Cancel", size=12, color=CAPTION, align="center"))
    return fr, kids


def build_onboarding_ready(ox, oy):
    """Brief pause after create — auto-continues to Home (~2s in prototype)."""
    fr = make_frame("11d Ready", ox, oy)
    fid = fr["id"]
    kids = []
    kids += logo(ox + 150, oy + 180, fid, fid, 1.0)
    kids.append(make_text("title", ox + 40, oy + 320, 310, 28, fid, fid, "YOU'RE READY", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 40,
            oy + 364,
            310,
            48,
            fid,
            fid,
            "Passkey synced.\nWallet is ready to use.",
            size=13,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(
        make_text(
            "auto",
            ox + 28,
            oy + 460,
            334,
            24,
            fid,
            fid,
            "Opening wallet…",
            size=14,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


BUILDERS = {
    "01 Home": lambda x, y: build_home(x, y, False),
    "01b Home privacy": lambda x, y: build_home(x, y, True),
    "01c Wallet switcher": build_wallet_switcher,
    "01j Edit wallet": build_edit_wallet,
    "01k Remove wallet warning": build_remove_wallet_warning,
    "01m Remove Lightning warning": build_remove_lightning_warning,
    "01d Activity sheet": build_activity,
    "01h Transaction details": build_tx_details,
    "01i Transaction details LN": build_tx_details_ln,
    "01e Lock biometrics": build_lock_biometrics,
    "01f Lock PIN": build_lock_pin,
    "01g Duress Home": build_duress_home,
    "02 Receive BIP21": build_receive,
    "02b Receive sheet": build_receive_sheet,
    "02c Receive share sheet": build_share_sheet,
    "02d Receive POS": build_receive_pos,
    "03 Send empty": lambda x, y: build_send(x, y, ready=False),
    "03b Send ready": lambda x, y: build_send(x, y, ready=True),
    "03c Send slide early": lambda x, y: build_send(x, y, ready=True, early=True),
    "03d Send slide mid": lambda x, y: build_send(x, y, ready=True, mid=True),
    "03e Send success": build_send_success,
    "03f Scan QR": build_scan_qr,
    "04 Swap BTC to USDT": build_swap,
    "04b Swap success": build_swap_success,
    "06 Connect Node": build_node,
    "06b Connect BTCPay": build_connect_btcpay,
    "06c Connect NWC": build_connect_nwc,
    "06d Connect Manual LND": build_connect_manual_lnd,
    "13 Node Status": build_node_status,
    "08 Contacts": build_contacts,
    "08d Contacts search": build_contacts_search,
    "08b Choose Recipient": build_choose_recipient,
    "08c Edit contact": build_edit_contact,
    "08e Add contact": build_add_contact,
    "09 Nostr Payment Request": build_nostr,  # alias → 09c
    "09 Nostr inbox": build_nostr_inbox,
    "09b Compose request": build_nostr_compose,
    "09c Incoming pay": build_nostr_incoming,
    "09d Outgoing pending": build_nostr_pending,
    "09e Accepted address": build_nostr_accepted,
    "09f Declined / expired": build_nostr_declined,
    "10 Multisig": lambda x, y: build_multisig(x, y, "main"),
    "10b Multisig invite": lambda x, y: build_multisig(x, y, "invite"),
    "10c Multisig pending": lambda x, y: build_multisig(x, y, "pending"),
    "10d Multisig cosign": lambda x, y: build_multisig(x, y, "cosign"),
    "10e Create vault": build_create_vault,
    "10f Import descriptor": build_import_descriptor,
    "11 Onboarding Create": build_onboarding,
    "11b Terms of Use (passkey)": lambda x, y: build_terms_of_use(x, y, "passkey"),
    "11b2 Terms of Use (device only)": lambda x, y: build_terms_of_use(x, y, "device-only"),
    "11b Passkey sync status": lambda x, y: build_terms_of_use(x, y, "passkey"),  # legacy alias
    "11c Passkey not found": build_passkey_not_found,
    "11d Ready": build_onboarding_ready,
    "11e Export recovery phrase": build_export_recovery_phrase,
    "14 Add wallet": build_add_wallet,
    "14b Create without passkey": build_create_without_passkey,
    "14c Name new wallet": build_name_new_wallet,
    "12 Advanced Backup": build_backup,
    "12d Nostr backup": build_nostr_backup,
    "12e Home server backup": build_home_server_backup,
    "12f Import nsec warning": build_import_nsec_gate,
    "12b Restore seed": lambda x, y: build_restore(x, y, mode="seed"),
    "12c Restore nsec": lambda x, y: build_restore(x, y, mode="nsec"),
    "12h Restore home server": lambda x, y: build_restore(x, y, mode="server"),
    "12b Restore from seed": lambda x, y: build_restore(x, y, mode="seed"),
    "05 Settings": build_settings,
    "05as Arkade Settings": build_arkade_settings,
    "05b Display currencies": build_currencies,
    "05c Privacy": lambda x, y: build_settings_simple(
        x, y, "05c Privacy", "PRIVACY", [("Biometrics lock", "ON"), ("App PIN", "Not set"), ("Block screenshots", "ON")]
    ),
    "05d Nostr identity": build_settings_nostr,
    "05i Export nsec warning": build_export_nsec_warning,
    "05j Export nsec reveal": build_export_nsec_reveal,
    "05k Generate identity warning": build_generate_identity_warning,
    "05e Backup": build_settings_backup_hub,
    "05f About": build_about,
    "05g Duress PIN": build_duress_setup,
    "05h Passkey status": build_settings_passkey,
    "07 Hardware Wallet": build_hw,
    "07b Pair hardware": build_hw_pair,
    "07c Confirm on device": build_hw_confirm,
}


def main():
    c = Client()
    c.login()
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])

    # 1) wipe everything except root
    to_del = [oid for oid, o in objs.items() if oid != ROOT and o.get("name") != "Root Frame"]
    print(f"wiping {len(to_del)} objects…")
    revn, vern = push(c, revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in to_del], chunk=80)

    # 2) rebuild
    changes = []
    frame_ids = {}
    for row_i, (section, names) in enumerate(LAYOUT):
        row_y = ORIGIN_Y + row_i * ROW
        lab = make_text(f"section · {section}", ORIGIN_X, row_y - 52, 900, 28, ROOT, ROOT, section, size=18, weight="700")
        add(changes, lab, ROOT, ROOT)
        for col_i, name in enumerate(names):
            tx, ty = ORIGIN_X + col_i * COL, row_y
            builder = BUILDERS[name]
            fr, kids = builder(tx, ty)
            finish(changes, fr, kids)
            frame_ids[name] = fr["id"]
            print(f"  queued {name} @ ({tx},{ty}) kids={len(kids)}")

    print(f"adding {len(changes)} objects…")
    revn, vern = push(c, revn, vern, changes, chunk=40)

    # 3) reposition comment pins onto new frames
    MAP = {
        1: ("01 Home", 195, 388),
        2: ("01c Wallet switcher", 200, 400),
        3: ("01d Activity sheet", 200, 500),
        4: ("03c Send slide early", 200, 520),
        5: ("01 Home", 160, 280),
        6: ("01b Home privacy", 160, 280),
        7: ("02 Receive BIP21", 195, 280),
        8: ("03 Send empty", 195, 660),
        9: ("03 Send empty", 40, 100),
        10: ("01 Home", 100, 360),
        11: ("02 Receive BIP21", 150, 430),
        12: ("03b Send ready", 200, 560),
        13: ("03b Send ready", 200, 560),
        14: ("10 Multisig", 200, 400),
        15: ("08 Contacts", 200, 400),
        16: ("11 Onboarding Create", 200, 780),
        17: ("01 Home", 38, 58),
        18: ("01 Home", 195, 750),
        19: ("02c Receive share sheet", 200, 500),
        20: ("01 Home", 38, 58),
        21: ("03c Send slide early", 200, 500),
    }
    threads = {t["seqn"]: t for t in c.get(f"/api/rpc/command/get-comment-threads?file-id={FILE}")}
    # need frame positions
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}
    for seqn, (fname, rx, ry) in MAP.items():
        t = threads.get(seqn)
        fr = frames.get(fname)
        if not t or not fr:
            continue
        pos = {"x": fr["x"] + rx, "y": fr["y"] + ry}
        st, _ = c.post(
            "/api/rpc/command/update-comment-thread-position",
            {"id": t["id"], "position": pos, "frame-id": fr["id"]},
        )
        print(f"  pin #{seqn} -> {fname} ({st})")

    # verify no desync
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    bad = 0
    print("\n=== FINAL ===")
    for o in sorted([o for o in objs.values() if o.get("type") == "frame" and o.get("name") != "Root Frame"], key=lambda x: (x["y"], x["x"])):
        sx, sy = o["selrect"]["x"], o["selrect"]["y"]
        ok = abs(sx - o["x"]) < 0.5 and abs(sy - o["y"]) < 0.5
        if not ok:
            bad += 1
        print(f"  {o['name']:32} xy=({o['x']:.0f},{o['y']:.0f}) sel=({sx:.0f},{sy:.0f}) {'OK' if ok else 'BAD'}")
    print("desync", bad)
    print("DONE")


if __name__ == "__main__":
    main()
