#!/usr/bin/env python3
"""Receive → POS: swipe R→L opens BTCPay-style amount keypad (pos.davidcoen.it).

Rebuilds only page «02 Receive»: BIP21 (+ swipe affordance), POS keypad, format/share sheets.
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

_spec = importlib.util.spec_from_file_location("rb", Path(__file__).with_name("penpot_rebuild_clean.py"))
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

ORIGIN_X, BOARD_Y = 40, 320
PHONE_W, PHONE_H = 390, 844
NOTE_W, NOTE_SIDE_GAP = 320, 24
COL = PHONE_W + NOTE_SIDE_GAP + NOTE_W + 40  # ~774

PAGE_NAME = "02 Receive"
BOARDS = [
    "02 Receive BIP21",
    "02d Receive POS",
    "02b Receive sheet",
    "02c Receive share sheet",
]

NOTES = {
    "02 Receive BIP21": (
        "02 Receive · RN",
        "Title = RECEIVE.\n\n"
        "BIP21 field + Copy + Share flush RIGHT of the field.\n\n"
        "Gesture: horizontal PanResponder / Reanimated.\n"
        "Swipe RIGHT → LEFT → 02d Receive POS (amount keypad).\n"
        "Edge chevron «‹» = affordance.",
    ),
    "02d Receive POS": (
        "02d POS · BTCPay keypad",
        "Inspired by pos.davidcoen.it (BTCPay Keypad POS).\n\n"
        "Layout: currency code → big amount → 3×4 keypad → primary CTA.\n"
        "Keys: 1–9 / C (clear) / 0 / ⌫. Sample amount 12,50 EUR.\n"
        "CTA «Request» → BIP21 with amount= → QR scene.\n\n"
        "Swipe LEFT → RIGHT returns to BIP21 QR.\n"
        "RN: same pager as Receive; no modal.",
    ),
    "02b Receive sheet": (
        "02b Format · bottom sheet",
        "Each row: format name + string with middle ellipsis\n"
        "(start…end) so users can verify both ends.\n"
        "Tap row → copy that string.",
    ),
    "02c Receive share sheet": (
        "02c Share · Android-style",
        "Share opens a bottom sheet like Android text share.\n"
        "Body: “This is my address:” + BIP21.",
    ),
}


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
        self.post("/api/rpc/command/login-with-password", {"email": EMAIL, "password": PASSWORD})

    def update(self, revn, vern, changes):
        return self.post(
            "/api/rpc/command/update-file",
            {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
        )


def push(c, revn, vern, changes, chunk=35):
    for i in range(0, len(changes), chunk):
        part = changes[i : i + chunk]
        st, out = c.update(revn, vern, part)
        if st != 200:
            raise SystemExit(f"fail @{i}: {out}")
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
    return revn, vern


def add(changes, page_id, obj, parent, frame):
    changes.append(
        {"type": "add-obj", "id": obj["id"], "page-id": page_id, "frame-id": frame, "parent-id": parent, "obj": obj}
    )


def line(x1, y1, x2, y2):
    return [
        {"command": "move-to", "params": {"x": x1, "y": y1}},
        {"command": "line-to", "params": {"x": x2, "y": y2}},
    ]


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
    return rb.make_path("ico-copy", parent, frame, cmds, sw=1.5)


def icon_share_android(cx, cy, parent, frame):
    cmds = []
    cmds += line(cx - 8, cy + 2, cx - 8, cy + 9)
    cmds += line(cx - 8, cy + 9, cx + 8, cy + 9)
    cmds += line(cx + 8, cy + 9, cx + 8, cy + 2)
    cmds += line(cx, cy + 6, cx, cy - 8)
    cmds += line(cx, cy - 8, cx - 5, cy - 3)
    cmds += line(cx, cy - 8, cx + 5, cy - 3)
    return rb.make_path("ico-share", parent, frame, cmds, sw=1.7)


def swipe_chevron_left(cx, cy, parent, frame):
    """Edge affordance: chevron pointing left (swipe R→L to POS)."""
    cmds = line(cx + 4, cy - 10, cx - 4, cy) + line(cx - 4, cy, cx + 4, cy + 10)
    return rb.make_path("swipe-chevron", parent, frame, cmds, sw=2.0, stroke="#666666")


def swipe_chevron_right(cx, cy, parent, frame):
    cmds = line(cx - 4, cy - 10, cx + 4, cy) + line(cx + 4, cy, cx - 4, cy + 10)
    return rb.make_path("swipe-back", parent, frame, cmds, sw=2.0, stroke="#666666")


def bottom_sheet_chrome(ox, oy, parent, frame, sheet_h=420):
    kids = []
    kids.append(rb.make_rect("scrim", ox, oy, PHONE_W, PHONE_H, parent, frame, fill="#000000", stroke=None, rx=28))
    top = oy + PHONE_H - sheet_h
    kids.append(rb.make_rect("sheet", ox + 0, top, PHONE_W, sheet_h, parent, frame, fill="#111111", stroke="#FFFFFF", rx=20))
    kids.append(rb.make_rect("grab", ox + 165, top + 12, 60, 5, parent, frame, fill="#555555", stroke=None, rx=2.5))
    return kids, top


def note_height(body: str) -> int:
    lines = 0
    for block in body.split("\n"):
        lines += max(1, (len(block) // 42) + 1)
    return max(150, min(360, 54 + lines * 15))


def make_note(page_id, title, body, x, y):
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
    rb.geom(frame, x, y, NOTE_W, h)
    title_o = rb.make_text(
        "note-title", x + 14, y + 12, NOTE_W - 28, 22, fid, fid, title, size=12, color="#1A1A1A", weight="700"
    )
    body_o = rb.make_text(
        "note-body", x + 14, y + 40, NOTE_W - 28, h - 54, fid, fid, body, size=10, color="#1A1A1A"
    )
    frame["shapes"] = [title_o["id"], body_o["id"]]
    return [
        {"type": "add-obj", "id": frame["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame},
        {"type": "add-obj", "id": title_o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": title_o},
        {"type": "add-obj", "id": body_o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": body_o},
    ]


def build_receive(ox, oy):
    fr = rb.make_frame("02 Receive BIP21", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(rb.make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center"))
    kids.append(
        rb.make_text("balance", ox + 40, oy + 145, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "fiat", ox + 40, oy + 182, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center"
        )
    )
    n, cell = 21, 13
    qr_px = n * cell
    qx = ox + (390 - qr_px) // 2
    qy = oy + 230
    kids += rb.fake_qr(qx, qy, fid, fid, n=n, cell=cell)
    kids.append(
        rb.make_text(
            "hint", ox + 40, qy + qr_px + 16, 310, 18, fid, fid, "Scan BIP21 or use actions", size=12, color="#8C8C8C", align="center"
        )
    )
    field_y = qy + qr_px + 48
    kids.append(rb.make_rect("pill", ox + 28, field_y, 250, 48, fid, fid, stroke="#FFFFFF", rx=10))
    kids.append(rb.make_text("bip21", ox + 36, field_y + 14, 230, 24, fid, fid, rb.mid_ellipsis(rb.DEMO_BIP21, 16, 6), size=11))
    kids.append(icon_copy(ox + 302, field_y + 24, fid, fid))
    kids.append(icon_share_android(ox + 348, field_y + 24, fid, fid))
    kids.append(rb.make_text("copy-l", ox + 280, field_y + 56, 50, 14, fid, fid, "Copy", size=10, color="#8C8C8C", align="center"))
    kids.append(
        rb.make_text("share-l", ox + 328, field_y + 56, 50, 14, fid, fid, "Share", size=10, color="#8C8C8C", align="center")
    )
    # Swipe affordance (right edge): R→L opens POS
    kids.append(swipe_chevron_left(ox + 378, oy + 420, fid, fid))
    kids.append(
        rb.make_text(
            "swipe-hint",
            ox + 300,
            oy + 780,
            80,
            40,
            fid,
            fid,
            "swipe\n← POS",
            size=10,
            color="#666666",
            align="right",
        )
    )
    return fr, kids


def build_pos(ox, oy):
    """BTCPay keypad POS adapted to Basic dark theme."""
    fr = rb.make_frame("02d Receive POS", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(rb.make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center"))
    kids.append(
        rb.make_text("mode", ox + 40, oy + 128, 310, 18, fid, fid, "POS · enter amount", size=12, color="#8C8C8C", align="center")
    )

    # Amount display (BTCPay: currency above large amount)
    kids.append(rb.make_text("ccy", ox + 40, oy + 180, 310, 22, fid, fid, "EUR", size=14, color="#8C8C8C", weight="700", align="center"))
    kids.append(
        rb.make_text("amt", ox + 40, oy + 210, 310, 64, fid, fid, "12,50", size=52, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "sats", ox + 40, oy + 278, 310, 20, fid, fid, "≈ 25,641 sats · USD 13.48", size=13, color="#8C8C8C", align="center"
        )
    )

    # Keypad panel
    pad_x, pad_y = ox + 40, oy + 330
    pad_w, pad_h = 310, 340
    kids.append(rb.make_rect("pad", pad_x, pad_y, pad_w, pad_h, fid, fid, fill="#141414", stroke="#333333", rx=16))

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
                rb.make_text(
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
                    color="#FFFFFF" if label not in ("C", "⌫") else "#8C8C8C",
                )
            )

    # Primary CTA (BTCPay = Charge; wallet = Request)
    kids.append(rb.make_rect("cta", ox + 40, oy + 700, 310, 52, fid, fid, fill="#FFFFFF", stroke=None, rx=12))
    kids.append(
        rb.make_text("ctal", ox + 40, oy + 714, 310, 28, fid, fid, "Request", size=17, color="#000000", weight="700", align="center")
    )

    # Back swipe affordance
    kids.append(swipe_chevron_right(ox + 18, oy + 420, fid, fid))
    kids.append(
        rb.make_text("back-hint", ox + 10, oy + 780, 90, 40, fid, fid, "swipe\nQR →", size=10, color="#666666", align="left")
    )
    return fr, kids


def build_receive_format_sheet(ox, oy):
    fr = rb.make_frame("02b Receive sheet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        rb.make_text("ghost", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center", color="#333333")
    )
    sheet_kids, top = bottom_sheet_chrome(ox, oy, fid, fid, sheet_h=480)
    kids += sheet_kids
    kids.append(rb.make_text("st", ox + 28, top + 24, 334, 24, fid, fid, "Copy as…", size=16, weight="700"))
    rows = [
        ("BIP21 URL", rb.mid_ellipsis(rb.DEMO_BIP21, 18, 6)),
        ("Native segwit (bc1)", rb.mid_ellipsis(rb.DEMO_BC1, 10, 6)),
        ("Taproot", rb.mid_ellipsis(rb.DEMO_TAPROOT, 10, 6)),
        ("Ark address", rb.mid_ellipsis(rb.DEMO_ARK, 8, 6)),
        ("Lightning invoice", rb.mid_ellipsis(rb.DEMO_LN, 10, 6)),
    ]
    for i, (label, value) in enumerate(rows):
        yy = top + 60 + i * 72
        kids.append(rb.make_rect(f"row-{i}", ox + 28, yy, 334, 64, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids.append(rb.make_text(f"rl-{i}", ox + 44, yy + 10, 300, 20, fid, fid, label, size=13, weight="700"))
        kids.append(rb.make_text(f"rv-{i}", ox + 44, yy + 34, 280, 22, fid, fid, value, size=11, color="#8C8C8C"))
        kids.append(rb.make_text(f"ch-{i}", ox + 320, yy + 20, 30, 22, fid, fid, "›", size=16, color="#666666", align="right"))
    return fr, kids


def build_share_sheet(ox, oy):
    fr = rb.make_frame("02c Receive share sheet", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        rb.make_text("ghost", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE", size=20, weight="700", align="center", color="#333333")
    )
    sheet_kids, top = bottom_sheet_chrome(ox, oy, fid, fid, sheet_h=480)
    kids += sheet_kids
    kids.append(rb.make_text("st", ox + 28, top + 28, 334, 24, fid, fid, "Share", size=16, weight="700"))
    kids.append(
        rb.make_text(
            "share-preview",
            ox + 28,
            top + 70,
            334,
            70,
            fid,
            fid,
            f"This is my address:\n{rb.mid_ellipsis(rb.DEMO_BIP21, 18, 6)}",
            size=12,
        )
    )
    for i, label in enumerate(["Messages", "Mail", "Drive", "Copy"]):
        xx = ox + 28 + i * 86
        kids.append(rb.make_rect(f"app-{i}", xx, top + 170, 70, 70, fid, fid, fill="#1A1A1A", stroke="#555555", rx=16))
        kids.append(rb.make_text(f"al-{i}", xx, top + 250, 70, 18, fid, fid, label, size=10, color="#8C8C8C", align="center"))
    kids.append(rb.make_rect("sys", ox + 28, top + 300, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text("sysl", ox + 28, top + 314, 334, 24, fid, fid, "Share BIP21 via…", size=14, color="#000000", weight="700", align="center")
    )
    return fr, kids


BUILDERS = {
    "02 Receive BIP21": build_receive,
    "02d Receive POS": build_pos,
    "02b Receive sheet": build_receive_format_sheet,
    "02c Receive share sheet": build_share_sheet,
}


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}
    page_id = pages[PAGE_NAME]

    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") != "Root Frame"
    ]
    print(f"wipe {PAGE_NAME}: {len(wipe)}")
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    # 2 rows: BIP21 | POS ; sheets
    row1 = BOARDS[:2]
    row2 = BOARDS[2:]
    layout = [(BOARD_Y, row1), (BOARD_Y + 1004, row2)]

    changes = []
    for by, names in layout:
        for col_i, bname in enumerate(names):
            bx = ORIGIN_X + col_i * COL
            fr, kids = BUILDERS[bname](bx, by)
            if bname in NOTES:
                changes.extend(make_note(page_id, *NOTES[bname], bx + PHONE_W + NOTE_SIDE_GAP, by))
            fr["shapes"] = [k["id"] for k in kids]
            add(changes, page_id, fr, ROOT, ROOT)
            for k in kids:
                add(changes, page_id, k, fr["id"], fr["id"])
            print(f"  + {bname} @ {bx},{by}")

    print(f"push {len(changes)}")
    revn, vern = push(c, revn, vern, changes, chunk=35)
    print("DONE revn", revn)


if __name__ == "__main__":
    main()
