#!/usr/bin/env python3
"""Add Home boards to Penpot page «Pay in Chat»:

  15k Home · Chat & Pay card   — shipped CTA card above Activity (Receive↔Send width)
  15l Home · Chat & Pay list   — list-style rows (chat bubble + chevron; muted Private Chats)

Does NOT wipe existing Pay in Chat boards — only replaces these two by name.
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

PAGE_NAME = "Pay in Chat"
PHONE_W, PHONE_H = 390, 844
COL, ROW = 460, 1004
# Place after existing 15…15j grid (10 boards → next free col/row)
ORIGIN_X, ORIGIN_Y = 40 + 1 * COL, 320 + 3 * ROW  # col1 row3 ≈ after 15j
NOTE_W = 390
CAPTION = "#B3B3B3"
HINT = "#999999"

_spec = importlib.util.spec_from_file_location(
    "rebuild", Path(__file__).with_name("penpot_rebuild_clean.py")
)
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

BOARD_CARD = "15k Home · Chat & Pay card"
BOARD_LIST = "15l Home · Chat & Pay list"

SCENE_NOTES = {
    BOARD_CARD: (
        BOARD_CARD,
        "Current shipped Home entry for Chat & Pay.\n\n"
        "Card above Activity swipe handle, same horizontal span as Receive↔Send "
        "(maxWidth ~336). Title + muted hint. Optional unread badge top-right.\n\n"
        "Tap → Pay hub (15g).",
    ),
    BOARD_LIST: (
        BOARD_LIST,
        "Alt Home entry — list rows (David mock).\n\n"
        "Below Receive/Send: chat-bubble icon + Chat & Pay + chevron; "
        "under it muted Private Chats & Contacts + chevron.\n\n"
        "Basic dark / JetBrains Mono. No card chrome.",
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
    return max(160, min(380, 54 + lines * 16))


def make_note(page_id: str, title: str, body: str, x: float, y: float):
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
        "note-title", x + 14, y + 12, NOTE_W - 28, 22, fid, fid, title, size=13, color="#1A1A1A", weight="700"
    )
    body_o = rb.make_text(
        "note-body", x + 14, y + 40, NOTE_W - 28, h - 54, fid, fid, body, size=11, color="#1A1A1A"
    )
    kids = [title_o, body_o]
    frame["shapes"] = [k["id"] for k in kids]
    changes = [
        {"type": "add-obj", "id": fid, "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame}
    ]
    for k in kids:
        k["frame-id"] = fid
        k["parent-id"] = fid
        changes.append(
            {"type": "add-obj", "id": k["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": k}
        )
    return changes, h


def home_chrome(ox, oy, fid, kids):
    """Shared Home chrome: avatar, logo, balance, Receive/Send (shipped widths)."""
    kids += rb.avatar(ox + 38, oy + 58, 11, fid, fid)
    kids += rb.logo(ox + 145, oy + 70, fid, fid, 1.0)
    kids.append(
        rb.make_text(
            "balance",
            ox + 40,
            oy + 250,
            310,
            40,
            fid,
            fid,
            "R$ 18,09",
            size=28,
            weight="700",
            align="center",
        )
    )
    kids.append(
        rb.make_text(
            "fiat",
            ox + 40,
            oy + 292,
            310,
            24,
            fid,
            fid,
            "≈ 3,210 sats",
            size=13,
            color="#8C8C8C",
            align="center",
        )
    )
    # Receive ↔ Send — same span as app (≈160 each + gap 16 → ~336)
    kids.append(rb.make_rect("btn-receive", ox + 27, oy + 360, 160, 56, fid, fid, rx=10))
    kids.append(
        rb.make_text("label-receive", ox + 27, oy + 376, 160, 24, fid, fid, "Receive", size=16, align="center")
    )
    kids.append(rb.make_rect("btn-send", ox + 203, oy + 360, 160, 56, fid, fid, rx=10))
    kids.append(
        rb.make_text("label-send", ox + 203, oy + 376, 160, 24, fid, fid, "Send", size=16, align="center")
    )


def chat_bubble_icon(ox, oy, parent, frame, size=22):
    """Simple speech-bubble glyph as rounded rect + tail path."""
    kids = []
    kids.append(
        rb.make_rect(
            "bubble-body",
            ox,
            oy,
            size,
            size * 0.72,
            parent,
            frame,
            fill=None,
            stroke="#FFFFFF",
            sw=1.6,
            rx=5,
        )
    )
    # Tail
    cmds = rb.line(ox + 5, oy + size * 0.72, ox + 2, oy + size) + rb.line(
        ox + 2, oy + size, ox + 10, oy + size * 0.72
    )
    kids.append(rb.make_path("bubble-tail", parent, frame, cmds, sw=1.6))
    return kids


def chevron_right(ox, oy, parent, frame):
    cmds = rb.line(ox, oy, ox + 8, oy + 8) + rb.line(ox + 8, oy + 8, ox, oy + 16)
    return rb.make_path("chev", parent, frame, cmds, sw=1.8, stroke="#8C8C8C")


def build_home_card(ox, oy):
    fr = rb.make_frame(BOARD_CARD, ox, oy)
    fid = fr["id"]
    kids = []
    home_chrome(ox, oy, fid, kids)

    # CTA card — same width as Receive+Send span (336)
    card_x, card_y, card_w, card_h = ox + 27, oy + 440, 336, 64
    kids.append(
        rb.make_rect(
            "chat-card",
            card_x,
            card_y,
            card_w,
            card_h,
            fid,
            fid,
            fill="#0D0D0D",
            stroke="#333333",
            rx=12,
        )
    )
    kids.append(
        rb.make_text(
            "chat-title",
            card_x + 16,
            card_y + 12,
            240,
            22,
            fid,
            fid,
            "Chat & Pay",
            size=15,
            weight="700",
        )
    )
    kids.append(
        rb.make_text(
            "chat-hint",
            card_x + 16,
            card_y + 36,
            280,
            18,
            fid,
            fid,
            "Private chats · pay contacts",
            size=12,
            color=CAPTION,
        )
    )
    # Unread badge sample
    kids.append(
        rb.make_rect("badge", card_x + card_w - 34, card_y + 8, 22, 22, fid, fid, fill="#FFFFFF", stroke=None, rx=11)
    )
    kids.append(
        rb.make_text("badge-n", card_x + card_w - 34, card_y + 12, 22, 16, fid, fid, "2", size=11, color="#000000", weight="700", align="center")
    )

    # Activity handle
    kids.append(rb.make_rect("hist", ox + 165, oy + 730, 60, 5, fid, fid, fill="#555555", stroke=None, rx=2.5))
    kids.append(
        rb.make_text(
            "hist-hint",
            ox + 40,
            oy + 748,
            310,
            18,
            fid,
            fid,
            "swipe up for activity",
            size=12,
            color="#8C8C8C",
            align="center",
        )
    )
    kids.append(rb.rates(ox, oy, fid, fid))
    return fr, kids


def build_home_list(ox, oy):
    fr = rb.make_frame(BOARD_LIST, ox, oy)
    fid = fr["id"]
    kids = []
    home_chrome(ox, oy, fid, kids)

    # List rows below Receive/Send
    row_x, row_w = ox + 27, 336
    y1 = oy + 440
    # Row 1: Chat & Pay
    kids += chat_bubble_icon(row_x + 4, y1 + 10, fid, fid, size=22)
    kids.append(
        rb.make_text(
            "row1-title",
            row_x + 40,
            y1 + 12,
            240,
            22,
            fid,
            fid,
            "Chat & Pay",
            size=15,
            weight="700",
        )
    )
    kids.append(chevron_right(row_x + row_w - 20, y1 + 14, fid, fid))
    # Divider
    kids.append(
        rb.make_rect("div1", row_x, y1 + 48, row_w, 1, fid, fid, fill="#222222", stroke=None, rx=0)
    )

    # Row 2: Private Chats & Contacts (muted)
    y2 = y1 + 56
    kids += chat_bubble_icon(row_x + 4, y2 + 10, fid, fid, size=20)
    # Mute the bubble stroke via overlapping hint — use caption color path already white; add muted label
    kids.append(
        rb.make_text(
            "row2-title",
            row_x + 40,
            y2 + 12,
            260,
            22,
            fid,
            fid,
            "Private Chats & Contacts",
            size=14,
            color=CAPTION,
        )
    )
    kids.append(chevron_right(row_x + row_w - 20, y2 + 14, fid, fid))

    kids.append(rb.make_rect("hist", ox + 165, oy + 730, 60, 5, fid, fid, fill="#555555", stroke=None, rx=2.5))
    kids.append(
        rb.make_text(
            "hist-hint",
            ox + 40,
            oy + 748,
            310,
            18,
            fid,
            fid,
            "swipe up for activity",
            size=12,
            color="#8C8C8C",
            align="center",
        )
    )
    kids.append(rb.rates(ox, oy, fid, fid))
    return fr, kids


BUILDERS = [
    (BOARD_CARD, build_home_card),
    (BOARD_LIST, build_home_list),
]


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][p]["name"]: p for p in meta["data"]["pages"]}
    if PAGE_NAME not in pages:
        raise SystemExit(f"page missing: {PAGE_NAME}")
    page_id = pages[PAGE_NAME]
    print(f"page {PAGE_NAME} -> {page_id}")

    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])

    # Wipe previous copies of these boards + their notes
    wipe_names = {BOARD_CARD, BOARD_LIST, f"note · {BOARD_CARD}", f"note · {BOARD_LIST}"}
    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") in wipe_names
    ]
    # Also wipe children of those frames (Penpot may leave orphans if we only del frame —
    # del-obj on frame usually cascades; if not, match by name prefix)
    print(f"wipe prior boards/notes: {len(wipe)}")
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    # Layout: next to each other on a new row under existing grid
    positions = [
        (ORIGIN_X, ORIGIN_Y),
        (ORIGIN_X + COL, ORIGIN_Y),
    ]

    boards = {}
    for i, (name, builder) in enumerate(BUILDERS):
        ox, oy = positions[i]
        fr, kids = builder(ox, oy)
        boards[name] = (fr, kids, ox, oy)
        print(f"  build {name} id={fr['id']} @ ({ox},{oy})")

    changes = []
    for name, _ in reversed(BUILDERS):
        fr, kids, ox, oy = boards[name]
        finish(changes, fr, kids, page_id)

    for name, _ in BUILDERS:
        fr, kids, ox, oy = boards[name]
        title, body = SCENE_NOTES[name]
        note_h = note_height(body)
        note_y = oy - note_h - 24
        note_changes, _ = make_note(page_id, title, body, ox, note_y)
        changes.extend(note_changes)

    print(f"pushing {len(changes)} changes")
    revn, vern = push(c, revn, vern, changes, chunk=40)

    # Re-fetch ids for report
    objs2 = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    report = []
    for name in (BOARD_CARD, BOARD_LIST):
        for oid, o in objs2.items():
            if o.get("name") == name:
                report.append((name, oid))
                break
    print(f"done revn={revn} vern={vern}")
    for name, oid in report:
        print(f"BOARD {name} id={oid}")


if __name__ == "__main__":
    main()
