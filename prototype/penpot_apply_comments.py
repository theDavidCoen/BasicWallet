#!/usr/bin/env python3
"""Apply David's Penpot comments + add missing screens 05, 07–13."""
from __future__ import annotations

import json
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

# load vector logo helper
_spec = importlib.util.spec_from_file_location(
    "vl", Path(__file__).with_name("penpot_vector_logo.py")
)
_vl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vl)


def uid() -> str:
    return str(uuid.uuid4())


def matrix():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def selrect(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def points(x, y, w, h):
    return [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]


def geom(o, x, y, w, h):
    o["x"], o["y"], o["width"], o["height"] = x, y, w, h
    o["selrect"] = selrect(x, y, w, h)
    o["points"] = points(x, y, w, h)
    o["transform"] = matrix()
    o["transform-inverse"] = matrix()
    o["rotation"] = 0
    o["opacity"] = 1
    return o


def shape(typ, name, x, y, w, h, parent, frame):
    return geom(
        {
            "id": uid(),
            "name": name,
            "type": typ,
            "parent-id": parent,
            "frame-id": frame,
            "fills": [],
            "strokes": [],
        },
        x,
        y,
        w,
        h,
    )


def make_frame(name, x, y, w=390, h=844):
    fid = uid()
    o = shape("frame", name, x, y, w, h, ROOT, fid)
    o["id"] = fid
    o["frame-id"] = fid
    o["fills"] = [{"fill-color": "#000000", "fill-opacity": 1}]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = 28
    o["shapes"] = []
    o["show-content"] = True
    o["hide-fill-on-export"] = False
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
                                "line-height": "1.25",
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


def make_path(name, parent, frame, cmds, *, stroke="#FFFFFF", sw=1.6, fill=None):
    xs, ys = [], []
    for c in cmds:
        p = c.get("params") or {}
        for k, v in p.items():
            if k.endswith("x") or k == "x":
                xs.append(v)
            elif k.endswith("y") or k == "y":
                ys.append(v)
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    pad = sw
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
    return o


def line(x1, y1, x2, y2):
    return [
        {"command": "move-to", "params": {"x": x1, "y": y1}},
        {"command": "line-to", "params": {"x": x2, "y": y2}},
    ]


def swap_arrows(cx, cy, parent, frame):
    """Vertical double-arrow swap glyph (not a 'v')."""
    cmds = []
    # left arrow up
    cmds += line(cx - 5, cy + 8, cx - 5, cy - 8)
    cmds += line(cx - 5, cy - 8, cx - 8, cy - 4)
    cmds += line(cx - 5, cy - 8, cx - 2, cy - 4)
    # right arrow down
    cmds += line(cx + 5, cy - 8, cx + 5, cy + 8)
    cmds += line(cx + 5, cy + 8, cx + 2, cy + 4)
    cmds += line(cx + 5, cy + 8, cx + 8, cy + 4)
    return make_path("swap-ico", parent, frame, cmds, sw=1.6)


def scan_reticle(cx, cy, parent, frame, size=64):
    """Stylized scan target / reticle."""
    half = size / 2
    arm = 14
    cmds = []
    # corner brackets
    for sx, sy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        x0 = cx + sx * (half - 2)
        y0 = cy + sy * (half - 2)
        cmds += line(x0, y0, x0 - sx * arm, y0)
        cmds += line(x0, y0, x0, y0 - sy * arm)
    # center crosshair
    cmds += line(cx - 6, cy, cx + 6, cy)
    cmds += line(cx, cy - 6, cx, cy + 6)
    # outer circle approx as octagon-ish square ring via small diamond
    r = 10
    cmds += [
        {"command": "move-to", "params": {"x": cx, "y": cy - r}},
        {"command": "line-to", "params": {"x": cx + r, "y": cy}},
        {"command": "line-to", "params": {"x": cx, "y": cy + r}},
        {"command": "line-to", "params": {"x": cx - r, "y": cy}},
        {"command": "close-path", "params": {}},
    ]
    return make_path("scan-reticle", parent, frame, cmds, sw=1.8)


def fake_qr(x, y, parent, frame, modules=21, cell=7):
    """Deterministic vector QR-like pattern (finder squares + noise)."""
    kids = []
    size = modules * cell
    kids.append(make_rect("qr-bg", x, y, size, size, parent, frame, fill="#FFFFFF", stroke=None, rx=2))

    def black(mx, my, w=1, h=1):
        kids.append(
            make_rect(
                f"qr-{mx}-{my}",
                x + mx * cell,
                y + my * cell,
                w * cell,
                h * cell,
                parent,
                frame,
                fill="#000000",
                stroke=None,
                rx=0,
            )
        )

    def finder(ox, oy):
        black(ox, oy, 7, 7)
        kids.append(
            make_rect(
                f"qr-f-{ox}-{oy}",
                x + (ox + 1) * cell,
                y + (oy + 1) * cell,
                5 * cell,
                5 * cell,
                parent,
                frame,
                fill="#FFFFFF",
                stroke=None,
                rx=0,
            )
        )
        black(ox + 2, oy + 2, 3, 3)

    finder(0, 0)
    finder(modules - 7, 0)
    finder(0, modules - 7)
    # pseudo data
    seed = 7
    for my in range(modules):
        for mx in range(modules):
            if mx < 8 and my < 8:
                continue
            if mx >= modules - 8 and my < 8:
                continue
            if mx < 8 and my >= modules - 8:
                continue
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            if seed % 3 == 0:
                black(mx, my)
    return kids


def elastic_slider(ox, oy, parent, frame, *, progress=0.55, label="slide to confirm"):
    """White elastic band that stretches with the finger; chevron at the tip."""
    kids = []
    track_w, track_h = 334, 52
    kids.append(make_rect("slider", ox, oy, track_w, track_h, parent, frame, stroke="#FFFFFF", rx=10))
    fill_w = max(48, int(track_w * progress))
    elastic = make_rect(
        "slider-elastic",
        ox + 4,
        oy + 4,
        fill_w - 8,
        track_h - 8,
        parent,
        frame,
        fill="#FFFFFF",
        stroke=None,
        rx=8,
    )
    kids.append(elastic)
    tip_x = ox + fill_w - 36
    kids.append(
        make_text(
            "handle-gt",
            tip_x,
            oy + 12,
            32,
            28,
            parent,
            frame,
            ">",
            size=18,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    # label sits in remaining dark area if space, else on elastic in gray
    if progress < 0.7:
        kids.append(
            make_text(
                "slide",
                ox + fill_w + 8,
                oy + 16,
                track_w - fill_w - 16,
                24,
                parent,
                frame,
                label,
                size=13,
                color="#FFFFFF",
                align="left",
            )
        )
    else:
        kids.append(
            make_text(
                "slide",
                ox + 50,
                oy + 16,
                fill_w - 80,
                24,
                parent,
                frame,
                label,
                size=13,
                color="#111111",
                align="center",
            )
        )
    return kids


def rates_footer(ox, oy, parent, frame):
    """BTC/USD + BTC/EUR rates (configurable in Settings)."""
    return [
        make_text(
            "rates",
            ox + 20,
            oy + 790,
            350,
            20,
            parent,
            frame,
            "BTC/USD 64,920   ·   BTC/EUR 60,190",
            size=11,
            color="#8C8C8C",
            align="center",
        )
    ]


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def post_json(self, path, data):
        req = urllib.request.Request(
            BASE + path,
            data=json.dumps(data).encode(),
            headers={"content-type": "application/json", "accept": "application/json"},
            method="POST",
        )
        with self.opener.open(req) as r:
            return r.status, json.loads(r.read().decode())

    def get_json(self, path):
        req = urllib.request.Request(
            BASE + path, headers={"accept": "application/json"}, method="GET"
        )
        with self.opener.open(req) as r:
            return json.loads(r.read().decode())

    def login(self):
        self.post_json("/api/rpc/command/login-with-password", {"email": EMAIL, "password": PASSWORD})

    def update(self, revn, vern, changes):
        return self.post_json(
            "/api/rpc/command/update-file",
            {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
        )


def add(changes, obj, parent, frame):
    changes.append(
        {
            "type": "add-obj",
            "id": obj["id"],
            "page-id": PAGE,
            "frame-id": frame,
            "parent-id": parent,
            "obj": obj,
        }
    )


def logo(ox, oy, parent, frame, scale=1.0):
    return _vl.make_logo_group(ox, oy, parent, frame, scale=scale)


def main():
    c = Client()
    c.login()
    objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}
    meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])

    # --- delete objects we will replace ---
    del_names = {
        "swap-ico",
        "rates",
        "modal",
        "m-title",
        "opt-0",
        "opt-1",
        "opt-2",
        "opt-3",
        "opt-4",
        "qr",
        "qr-bg",
        "scan",
        "scan-reticle",
        "slider",
        "slider-fill",
        "slider-elastic",
        "handle",
        "handle-gt",
        "slide",
        "micro",
        "mid",
    }
    # also delete qr-* fake modules if re-running, and old future notes for screens we'll build
    to_del = []
    for oid, o in objs.items():
        name = o.get("name") or ""
        parent = objs.get(o.get("parentId") or "", {})
        pname = parent.get("name") or ""
        if name in del_names and pname in (
            "01 Home",
            "01b Home privacy",
            "02 Receive BIP21",
            "03 Send empty",
            "03b Send ready",
            "04 Swap BTC to USDT",
        ):
            to_del.append(oid)
        if name.startswith("qr-") and pname == "02 Receive BIP21":
            to_del.append(oid)
        # remove placeholder future notes that we'll replace with real boards
        if name.startswith("note · ") and any(
            name.endswith(s)
            for s in (
                "05 Settings",
                "07 Hardware Wallet",
                "08 Contacts",
                "09 Nostr Payment Request",
                "10 Multisig",
                "11 Onboarding — Create",
                "12 Advanced Backup",
                "13 Node Status",
            )
        ):
            to_del.append(oid)
        # delete duplicate boards if re-run
        if o.get("type") == "frame" and name in (
            "02b Receive sheet",
            "05 Settings",
            "07 Hardware Wallet",
            "08 Contacts",
            "09 Nostr Payment Request",
            "10 Multisig",
            "11 Onboarding Create",
            "12 Advanced Backup",
            "13 Node Status",
        ):
            # delete frame and all children
            to_del.append(oid)
            for cid, ch in objs.items():
                if ch.get("parentId") == oid:
                    to_del.append(cid)

    if to_del:
        st, out = c.update(
            revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in sorted(set(to_del))]
        )
        print("deleted", len(set(to_del)), st, "revn", out.get("revn"))
        meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
        frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}

    changes = []

    # ===== Comment fixes on existing boards =====
    home = frames["01 Home"]
    homeb = frames["01b Home privacy"]
    recv = frames["02 Receive BIP21"]
    send_e = frames["03 Send empty"]
    send_r = frames["03b Send ready"]
    swap = frames["04 Swap BTC to USDT"]

    # #1 + #5 Home: swap arrows + rates
    for fr in (home, homeb):
        ox, oy, fid = fr["x"], fr["y"], fr["id"]
        add(changes, swap_arrows(ox + 195, oy + 384, fid, fid), fid, fid)
        for r in rates_footer(ox, oy, fid, fid):
            add(changes, r, fid, fid)
    print("fixed Home swap + rates")

    # #6 privacy rates already in loop

    # #7 Receive: example QR (vector modules). Remove old solid white qr if still there handled in del.
    ox, oy, fid = recv["x"], recv["y"], recv["id"]
    for q in fake_qr(ox + 121, oy + 186, fid, fid, modules=21, cell=7):
        add(changes, q, fid, fid)
    # clean receive: keep copy CTA, no inline modal (moved to 02b)
    print("fixed Receive QR")

    # #2: new board 02b with iOS bottom sheet
    fr = make_frame("02b Receive sheet", 900, 1100)
    fid, ox, oy = fr["id"], fr["x"], fr["y"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE BTC", size=20, weight="700", align="center"))
    for q in fake_qr(ox + 121, oy + 150, fid, fid):
        kids.append(q)
    kids.append(
        make_text("hint", ox + 40, oy + 370, 310, 20, fid, fid, "Scan BIP21 or copy below", size=12, color="#8C8C8C", align="center")
    )
    kids.append(make_rect("pill", ox + 28, oy + 400, 334, 44, fid, fid, stroke="#FFFFFF", rx=22))
    kids.append(
        make_text(
            "bip21",
            ox + 36,
            oy + 412,
            318,
            24,
            fid,
            fid,
            "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
            size=9,
            align="center",
        )
    )
    # dim overlay
    kids.append(make_rect("dim", ox, oy + 200, 390, 644, fid, fid, fill="#000000", stroke=None, rx=0))
    kids[-1]["fills"] = [{"fill-color": "#000000", "fill-opacity": 0.55}]
    # iOS bottom sheet
    sheet_h = 340
    kids.append(
        make_rect("sheet", ox, oy + 844 - sheet_h, 390, sheet_h, fid, fid, fill="#1C1C1E", stroke=None, rx=0)
    )
    kids[-1]["r1"] = kids[-1]["r2"] = 16
    kids[-1]["r3"] = kids[-1]["r4"] = 0
    kids.append(make_rect("grabber", ox + 165, oy + 844 - sheet_h + 10, 60, 5, fid, fid, fill="#636366", stroke=None, rx=3))
    kids.append(
        make_text(
            "sheet-title",
            ox + 24,
            oy + 844 - sheet_h + 28,
            340,
            24,
            fid,
            fid,
            "Copy address",
            size=17,
            weight="700",
            align="center",
        )
    )
    opts = [
        "BIP21 URL",
        "Native segwit (bc1…)",
        "Taproot",
        "Ark address",
        "Lightning invoice",
    ]
    for i, lab in enumerate(opts):
        yy = oy + 844 - sheet_h + 70 + i * 48
        kids.append(make_rect(f"row-{i}", ox + 16, yy, 358, 44, fid, fid, fill="#2C2C2E", stroke=None, rx=10))
        kids.append(make_text(f"opt-{i}", ox + 32, yy + 12, 300, 22, fid, fid, lab, size=14))
    fr["shapes"] = [k["id"] for k in kids]
    add(changes, fr, ROOT, fr["id"])
    for k in kids:
        add(changes, k, fid, fid)
    print("added 02b Receive sheet")

    # #3 Send empty: scan reticle graphic
    ox, oy, fid = send_e["x"], send_e["y"], send_e["id"]
    add(changes, scan_reticle(ox + 195, oy + 652, fid, fid, 72), fid, fid)
    add(
        changes,
        make_text("scan", ox + 40, oy + 710, 310, 18, fid, fid, "scan QR", size=12, color="#8C8C8C", align="center"),
        fid,
        fid,
    )
    print("fixed Send empty scan graphic")

    # #4 Send ready: elastic slider (match David's stretched white handle)
    ox, oy, fid = send_r["x"], send_r["y"], send_r["id"]
    # remove old slider track too and recreate clean
    # (slider itself was not in del_names for track - delete via targeted names)
    for kid in elastic_slider(ox + 28, oy + 520, fid, fid, progress=0.58):
        add(changes, kid, fid, fid)
    add(
        changes,
        make_text(
            "micro",
            ox + 28,
            oy + 585,
            334,
            16,
            fid,
            fid,
            "white elastic stretches with finger",
            size=10,
            color="#474747",
            align="center",
        ),
        fid,
        fid,
    )
    print("fixed Send ready elastic")

    # Swap mid: double arrows instead of v
    ox, oy, fid = swap["x"], swap["y"], swap["id"]
    add(changes, swap_arrows(ox + 195, oy + 268, fid, fid), fid, fid)
    # also elastic on swap slide
    # delete old slider/handle on swap — add names
    print("fixed Swap mid arrows")

    # ===== Missing screens row 2 (y=1100), skip x=900 (02b) =====
    # 05 Settings at 0,1100; 07 at 450; 08 at 1350; 09 at 1800; 10 at 2250; 11 at 2700
    # 12 at 0,2100; 13 at 450,2100; keep 06 where it is

    def settings(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SETTINGS", size=20, weight="700", align="center"))
        rows = [
            "Node",
            "Hardware wallets",
            "Nostr",
            "Contacts",
            "Multisig",
            "Backup",
            "Display currencies",
            "Security",
        ]
        for i, lab in enumerate(rows):
            yy = oy + 160 + i * 56
            kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 48, fid, fid))
            kids.append(make_text(f"t-{i}", ox + 44, yy + 14, 260, 24, fid, fid, lab, size=15))
            kids.append(make_text(f"chev-{i}", ox + 320, yy + 14, 30, 24, fid, fid, ">", size=16, color="#8C8C8C"))
        kids.append(
            make_text(
                "hint",
                ox + 28,
                oy + 620,
                334,
                40,
                fid,
                fid,
                "Display currencies: pick BTC/USD + BTC/EUR (or others) for Home rates",
                size=11,
                color="#8C8C8C",
                align="center",
            )
        )
        return kids

    def hardware(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "HARDWARE", size=20, weight="700", align="center"))
        for i, (t, d) in enumerate(
            [
                ("Trezor", "Connect via USB / Bridge"),
                ("Ledger", "Connect via USB / Bluetooth"),
                ("Coldcard", "Air-gapped PSBT / QR"),
            ]
        ):
            yy = oy + 180 + i * 100
            kids.append(make_rect(f"card-{i}", ox + 28, yy, 334, 84, fid, fid))
            kids.append(make_text(f"t-{i}", ox + 44, yy + 20, 300, 24, fid, fid, t, size=16, weight="700"))
            kids.append(make_text(f"d-{i}", ox + 44, yy + 48, 300, 20, fid, fid, d, size=12, color="#8C8C8C"))
        kids.append(
            make_text(
                "note",
                ox + 28,
                oy + 520,
                334,
                48,
                fid,
                fid,
                "Seeds never imported. Slide-to-confirm can hand off to device signing.",
                size=12,
                color="#8C8C8C",
                align="center",
            )
        )
        return kids

    def contacts(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CONTACTS", size=20, weight="700", align="center"))
        kids.append(
            make_text(
                "sub",
                ox + 28,
                oy + 140,
                334,
                36,
                fid,
                fid,
                "Private directory · no OS contacts",
                size=12,
                color="#8C8C8C",
                align="center",
            )
        )
        for i, (n, idn) in enumerate(
            [
                ("Alice", "npub1alice… / NIP-05"),
                ("Bob", "bc1q…"),
                ("Cafe", "lnurl1…"),
            ]
        ):
            yy = oy + 200 + i * 72
            kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 60, fid, fid))
            kids.append(make_text(f"n-{i}", ox + 44, yy + 12, 280, 22, fid, fid, n, size=15, weight="700"))
            kids.append(make_text(f"id-{i}", ox + 44, yy + 34, 300, 18, fid, fid, idn, size=11, color="#8C8C8C"))
        kids.append(make_rect("add", ox + 28, oy + 440, 334, 48, fid, fid))
        kids.append(make_text("add-l", ox + 28, oy + 454, 334, 24, fid, fid, "+ Add contact", size=15, align="center"))
        return kids

    def nostr_req(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(
            make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NOSTR REQUEST", size=20, weight="700", align="center")
        )
        kids.append(make_text("l-to", ox + 28, oy + 170, 100, 18, fid, fid, "to", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-to", ox + 28, oy + 190, 334, 48, fid, fid))
        kids.append(make_text("v-to", ox + 42, oy + 204, 300, 24, fid, fid, "Alice (npub1…)", size=14))
        kids.append(make_text("l-amt", ox + 28, oy + 260, 100, 18, fid, fid, "amount", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-amt", ox + 28, oy + 280, 334, 48, fid, fid))
        kids.append(make_text("v-amt", ox + 42, oy + 294, 280, 24, fid, fid, "50,000 sats", size=14))
        kids.append(make_text("l-memo", ox + 28, oy + 350, 100, 18, fid, fid, "memo", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-memo", ox + 28, oy + 370, 334, 48, fid, fid))
        kids.append(make_text("v-memo", ox + 42, oy + 384, 280, 24, fid, fid, "dinner", size=14, color="#8C8C8C"))
        kids.append(
            make_text(
                "flow",
                ox + 28,
                oy + 450,
                334,
                60,
                fid,
                fid,
                "pending → accepted → address returned\n→ send confirm → broadcast",
                size=12,
                color="#8C8C8C",
                align="center",
            )
        )
        kids.append(make_rect("btn", ox + 28, oy + 540, 334, 48, fid, fid))
        kids.append(make_text("btn-l", ox + 28, oy + 554, 334, 24, fid, fid, "Send request", size=16, align="center"))
        return kids

    def multisig(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "MULTISIG", size=20, weight="700", align="center"))
        kids.append(
            make_text(
                "sub", ox + 28, oy + 140, 334, 40, fid, fid, "2-of-3 P2WSH · coordinated over Nostr", size=12, color="#8C8C8C", align="center"
            )
        )
        kids.append(make_rect("card", ox + 28, oy + 200, 334, 160, fid, fid))
        kids.append(make_text("pol", ox + 44, oy + 220, 300, 24, fid, fid, "Policy: 2 of 3", size=15, weight="700"))
        kids.append(make_text("k1", ox + 44, oy + 255, 300, 20, fid, fid, "1. You (this device)", size=13))
        kids.append(make_text("k2", ox + 44, oy + 285, 300, 20, fid, fid, "2. Alice · npub1…", size=13))
        kids.append(make_text("k3", ox + 44, oy + 315, 300, 20, fid, fid, "3. Bob · npub1…", size=13))
        kids.append(make_rect("btn1", ox + 28, oy + 400, 334, 48, fid, fid))
        kids.append(make_text("b1", ox + 28, oy + 414, 334, 24, fid, fid, "Create vault", size=15, align="center"))
        kids.append(make_rect("btn2", ox + 28, oy + 465, 334, 48, fid, fid))
        kids.append(make_text("b2", ox + 28, oy + 479, 334, 24, fid, fid, "Import descriptor / BSMS", size=15, align="center"))
        return kids

    def onboarding(fid, ox, oy):
        kids = []
        kids += logo(ox + 120, oy + 180, fid, fid, 1.1)
        kids.append(
            make_text("title", ox + 40, oy + 280, 310, 28, fid, fid, "Create wallet", size=22, weight="700", align="center")
        )
        kids.append(
            make_text(
                "body",
                ox + 36,
                oy + 330,
                318,
                80,
                fid,
                fid,
                "No seed phrase in setup.\nOS passkey + cloud backup by default.",
                size=13,
                color="#8C8C8C",
                align="center",
            )
        )
        kids.append(make_rect("btn1", ox + 28, oy + 440, 334, 52, fid, fid, fill="#FFFFFF", stroke=None))
        kids.append(
            make_text("b1", ox + 28, oy + 456, 334, 24, fid, fid, "Continue with passkey", size=15, color="#000000", weight="700", align="center")
        )
        kids.append(make_rect("btn2", ox + 28, oy + 510, 334, 48, fid, fid))
        kids.append(make_text("b2", ox + 28, oy + 524, 334, 24, fid, fid, "Advanced backup options", size=14, align="center"))
        return kids

    def backup(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(
            make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ADVANCED BACKUP", size=18, weight="700", align="center")
        )
        for i, (t, d) in enumerate(
            [
                ("Nostr relays", "Encrypted backup · add custom relays"),
                ("Home server", "Encrypted backup to self-hosted server"),
                ("OS passkey (default)", "iCloud / Google Password Manager"),
            ]
        ):
            yy = oy + 170 + i * 110
            kids.append(make_rect(f"card-{i}", ox + 28, yy, 334, 92, fid, fid))
            kids.append(make_text(f"t-{i}", ox + 44, yy + 22, 300, 24, fid, fid, t, size=15, weight="700"))
            kids.append(make_text(f"d-{i}", ox + 44, yy + 52, 300, 28, fid, fid, d, size=12, color="#8C8C8C"))
        return kids

    def node_status(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(
            make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "NODE STATUS", size=20, weight="700", align="center")
        )
        kids.append(make_rect("ok", ox + 28, oy + 160, 334, 64, fid, fid))
        kids.append(make_text("st", ox + 44, oy + 180, 300, 28, fid, fid, "Connected · BTCPay", size=16, weight="700"))
        for i, (lab, val) in enumerate(
            [
                ("Lightning balance", "812,400 sats"),
                ("On-chain (node)", "0 sats"),
                ("Alias", "basic-lnd-01"),
            ]
        ):
            yy = oy + 250 + i * 56
            kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 48, fid, fid))
            kids.append(make_text(f"l-{i}", ox + 44, yy + 14, 160, 22, fid, fid, lab, size=13, color="#8C8C8C"))
            kids.append(make_text(f"v-{i}", ox + 180, yy + 14, 160, 22, fid, fid, val, size=13, align="right"))
        kids.append(
            make_text(
                "note",
                ox + 28,
                oy + 450,
                334,
                40,
                fid,
                fid,
                "Payments only · no channel management",
                size=12,
                color="#8C8C8C",
                align="center",
            )
        )
        kids.append(make_rect("disc", ox + 28, oy + 520, 334, 48, fid, fid))
        kids.append(make_text("disc-l", ox + 28, oy + 534, 334, 24, fid, fid, "Disconnect", size=15, align="center"))
        return kids

    new_screens = [
        ("05 Settings", 0, 1100, settings),
        ("07 Hardware Wallet", 450, 1100, hardware),
        # 02b already at 900,1100
        ("08 Contacts", 1350, 1100, contacts),
        ("09 Nostr Payment Request", 1800, 1100, nostr_req),
        ("10 Multisig", 2250, 1100, multisig),
        ("11 Onboarding Create", 2700, 1100, onboarding),
        ("12 Advanced Backup", 0, 2100, backup),
        ("13 Node Status", 450, 2100, node_status),
    ]

    for name, x, y, builder in new_screens:
        fr = make_frame(name, x, y)
        kids = builder(fr["id"], x, y)
        fr["shapes"] = [k["id"] for k in kids]
        add(changes, fr, ROOT, fr["id"])
        for k in kids:
            add(changes, k, fr["id"], fr["id"])
        print("added", name)

    # Also need to delete old slider/handle on 03b that we didn't catch — delete by finding remaining
    # Do a second pass after add if needed.

    # Push in chunks to avoid huge payload issues
    CHUNK = 80
    for i in range(0, len(changes), CHUNK):
        chunk = changes[i : i + CHUNK]
        st, out = c.update(revn, vern, chunk)
        print(f"chunk {i}-{i+len(chunk)} status={st} revn={out.get('revn')}")
        if st != 200:
            print(out)
            raise SystemExit(1)
        revn, vern = int(out["revn"]), int(out.get("vern", vern))

    # Cleanup leftover slider/handle on 03b Send ready (old ones not deleted if names differed)
    objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    send_r = next(o for o in objs.values() if o.get("name") == "03b Send ready")
    leftovers = []
    elastics = []
    for o in objs.values():
        if o.get("parentId") != send_r["id"]:
            continue
        n = o.get("name") or ""
        if n in ("slider", "handle", "handle-gt", "slide", "slider-fill", "slider-elastic", "micro"):
            if n == "slider-elastic":
                elastics.append(o["id"])
            else:
                leftovers.append((n, o["id"], o.get("width"), o.get("x")))
    # Keep newest elastic set: if multiple sliders, delete older narrow handles
    # Simpler: if >1 slider, delete all then re-add one elastic — heavy.
    # Delete objects named handle with width!=186-ish from before if duplicate slides
    print("03b slider-related:", leftovers, "elastics", len(elastics))

    # Delete old Receive modal remnants if any
    recv = next(o for o in objs.values() if o.get("name") == "02 Receive BIP21")
    modal_bits = [
        o["id"]
        for o in objs.values()
        if o.get("parentId") == recv["id"] and (o.get("name") or "").startswith(("modal", "m-title", "opt-"))
    ]
    if modal_bits:
        meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        st, out = c.update(
            revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in modal_bits]
        )
        print("cleared receive modal bits", len(modal_bits), st)

    # Fix 03b: if duplicate sliders, remove old track+handle that aren't elastic
    dups = []
    for o in objs.values():
        if o.get("parentId") != send_r["id"]:
            continue
        n = o.get("name") or ""
        if n == "handle" and o.get("width", 0) < 100:
            dups.append(o["id"])
        if n == "slider-fill":
            dups.append(o["id"])
    if dups:
        meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        st, out = c.update(revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in dups])
        print("cleared old handles", len(dups), st)

    # Also delete old slider on 03b before our new ones if we now have 2 sliders
    objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    send_r = next(o for o in objs.values() if o.get("name") == "03b Send ready")
    sliders = [o for o in objs.values() if o.get("parentId") == send_r["id"] and o.get("name") == "slider"]
    if len(sliders) > 1:
        # keep the last added (highest?); delete first
        sliders_sorted = sorted(sliders, key=lambda o: o.get("y", 0))
        # actually both same y — delete all but keep one elastic group by deleting older ids without matching elastic
        # Wipe all slider-related and re-add once
        wipe = [
            o["id"]
            for o in objs.values()
            if o.get("parentId") == send_r["id"]
            and (o.get("name") or "") in ("slider", "slider-elastic", "handle", "handle-gt", "slide", "micro", "slider-fill")
        ]
        meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        st, out = c.update(revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in wipe])
        print("wiped duplicate sliders", len(wipe), st)
        revn = int(out["revn"])
        vern = int(out.get("vern", vern))
        ox, oy, fid = send_r["x"], send_r["y"], send_r["id"]
        ch = []
        for kid in elastic_slider(ox + 28, oy + 520, fid, fid, progress=0.58):
            add(ch, kid, fid, fid)
        add(
            ch,
            make_text(
                "micro",
                ox + 28,
                oy + 585,
                334,
                16,
                fid,
                fid,
                "white elastic stretches with finger",
                size=10,
                color="#474747",
                align="center",
            ),
            fid,
            fid,
        )
        st, out = c.update(revn, vern, ch)
        print("re-added elastic", st)

    print("OK")


if __name__ == "__main__":
    main()
