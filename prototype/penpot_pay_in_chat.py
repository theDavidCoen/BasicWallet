#!/usr/bin/env python3
"""Add Penpot page «Pay in Chat» — Revolut-style P2P chat UX, Basic visual system.

Creates / refreshes page boards:
  15 Pay in Chat · 15b Send amount · 15c Request · 15d Slide confirm
  15e Incoming request · 15f Empty thread
  15g Choose contact · 15h Amount · 15i Amount ready · 15j Choose asset

Uses the same helpers / chrome as penpot_rebuild_clean.py (JetBrains Mono,
black canvas, white primary CTAs, outlined secondaries, logo, yellow notes).
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
ORIGIN_X, ORIGIN_Y = 40, 320  # room for yellow notes above
NOTE_Y = 40
NOTE_W = 390
CAPTION = "#B3B3B3"
HINT = "#999999"

_spec = importlib.util.spec_from_file_location(
    "rebuild", Path(__file__).with_name("penpot_rebuild_clean.py")
)
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

SCENE_NOTES: dict[str, tuple[str, str]] = {
    "15 Pay in Chat": (
        "15 Pay in Chat",
        "Revolut-inspired P2P thread, Basic chrome.\n\n"
        "Header = contact name + identifier (npub / NIP-05), not OS contacts. "
        "Payment cards live in the timeline as first-class messages "
        "(You sent / You received) with sats primary + fiat caption + optional memo.\n\n"
        "Persistent Request · Send above the composer. "
        "No Revolut blue, no GIF stickers — black / white / #0D0D0D cards, JetBrains Mono.\n\n"
        "Entry: Contacts → open chat, or Send → contact with chat history.",
    ),
    "15b Send amount": (
        "15b Send amount",
        "Send from chat opens a sheet (not a full nav away).\n\n"
        "Sats entry + fiat rate line (same rules as Send §7). "
        "Memo optional. Continue → slide confirm (15d).\n\n"
        "Destination is the open contact; no Choose Recipient step.",
    ),
    "15c Request": (
        "15c Request",
        "Request = Nostr gift-wrap pay request (see §11), surfaced in-chat.\n\n"
        "Amount + memo → encrypted request to contact npub. "
        "Shows as an outgoing request card in the thread until accepted / expired.",
    ),
    "15d Slide confirm": (
        "15d Slide confirm",
        "Basic never instant-sends. Same elastic slide as Send.\n\n"
        "Chat stays under a dim scrim; slide confirms Arkade / LN / allowed L1. "
        "On success → payment card lands in thread (15).",
    ),
    "15e Incoming request": (
        "15e Incoming request",
        "Peer asked for sats. Card in thread with Pay · Decline.\n\n"
        "Pay → amount prefilled → slide. Decline / expire updates the card status. "
        "Accept path can still return a fresh receive address (gift-wrap) when needed.",
    ),
    "15f Empty thread": (
        "15f Empty thread",
        "First open with a contact: no history yet.\n\n"
        "Same header + Request/Send + composer. "
        "Hint copy explains chat is private, encrypted with account data.",
    ),
    "15g Choose contact": (
        "15g Choose contact",
        "Hub before chat / send — fictional private contacts.\n\n"
        "Search + recent rows (name, last activity, date). "
        "Tap row → thread (15) or straight to Amount (15h) if launched from Send.\n\n"
        "No OS contacts. Identifiers: npub / NIP-05 / lnurl / ark.",
    ),
    "15h Amount": (
        "15h Amount",
        "After Send — pick amount (empty state).\n\n"
        "Large amount + fee line + asset pill showing "
        "selected balance (Personal · BTC). Tap pill → 15j.\n\n"
        "Note field, quick presets, numeric keypad. "
        "Send disabled until amount > 0.",
    ),
    "15i Amount ready": (
        "15i Amount ready",
        "Same as 15h with amount entered.\n\n"
        "Send CTA active (white). Continue → slide confirm (15d). "
        "Fiat caption under sats when asset is Bitcoin.",
    ),
    "15j Choose asset": (
        "15j Choose asset",
        "Future multi-asset send from chat.\n\n"
        "Quick chips: BTC · USDT · EUR*. "
        "List shows wallet balances per asset. "
        "EUR* = EUR-based stablecoin (label TBD).\n\n"
        "Done returns to Amount with updated pill.",
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
    body_o = rb.shape("text", "note-body", x + 14, y + 40, NOTE_W - 28, h - 54, fid, fid)
    body_o["grow-type"] = "fixed"
    body_o["content"] = {
        "type": "root",
        "vertical-align": "top",
        "children": [{"type": "paragraph-set", "children": paragraphs}],
    }
    frame["shapes"] = [title_o["id"], body_o["id"]]
    changes = []
    changes.append(
        {"type": "add-obj", "id": frame["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame}
    )
    for o in (title_o, body_o):
        changes.append(
            {"type": "add-obj", "id": o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": o}
        )
    return changes, h


# --- shared chrome -----------------------------------------------------------

def chat_header(ox, oy, fid, *, name="Alice", handle="npub1…alice"):
    kids = []
    kids += rb.logo(ox + 150, oy + 40, fid, fid, 0.62)
    kids += rb.contact_initial_avatar(ox + 348, oy + 92, 16, name[0], fid, fid)
    kids.append(rb.make_text("cname", ox + 40, oy + 78, 250, 22, fid, fid, name, size=16, weight="700", align="center"))
    kids.append(
        rb.make_text("chandle", ox + 40, oy + 100, 250, 16, fid, fid, handle, size=11, color=CAPTION, align="center")
    )
    return kids


def date_divider(ox, oy, fid, label, y):
    return rb.make_text("date", ox + 40, y, 310, 16, fid, fid, label, size=11, color="#666666", align="center")


def text_bubble(ox, oy, fid, prefix, text, y, *, outgoing: bool, w=220):
    kids = []
    h = 40
    if outgoing:
        x = ox + PHONE_W - 28 - w
        kids.append(rb.make_rect(f"{prefix}-bg", x, y, w, h, fid, fid, fill="#FFFFFF", stroke=None, rx=12))
        kids.append(
            rb.make_text(f"{prefix}-t", x + 12, y + 11, w - 24, 20, fid, fid, text, size=13, color="#000000")
        )
    else:
        x = ox + 28
        kids.append(rb.make_rect(f"{prefix}-bg", x, y, w, h, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids.append(rb.make_text(f"{prefix}-t", x + 12, y + 11, w - 24, 20, fid, fid, text, size=13))
    return kids, h


def pay_card(
    ox,
    oy,
    fid,
    prefix,
    *,
    status: str,
    amount: str,
    fiat: str | None,
    memo: str | None,
    time: str,
    outgoing: bool,
    y: int,
    card_h: int = 118,
):
    kids = []
    w = 250
    if outgoing:
        x = ox + PHONE_W - 28 - w
        kids.append(rb.make_rect(f"{prefix}-bg", x, y, w, card_h, fid, fid, fill="#FFFFFF", stroke=None, rx=14))
        kids.append(
            rb.make_text(f"{prefix}-st", x + 14, y + 12, w - 28, 16, fid, fid, status, size=11, color="#333333")
        )
        kids.append(
            rb.make_text(
                f"{prefix}-amt", x + 14, y + 36, w - 28, 28, fid, fid, amount, size=22, weight="700", color="#000000"
            )
        )
        yy = y + 68
        if fiat:
            kids.append(rb.make_text(f"{prefix}-fiat", x + 14, yy, w - 28, 16, fid, fid, fiat, size=11, color="#666666"))
            yy += 18
        if memo:
            kids.append(rb.make_text(f"{prefix}-memo", x + 14, yy, w - 28, 16, fid, fid, memo, size=11, color="#444444"))
        kids.append(
            rb.make_text(
                f"{prefix}-tm", x + 14, y + card_h - 22, w - 28, 14, fid, fid, time, size=10, color="#888888", align="right"
            )
        )
    else:
        x = ox + 28
        kids.append(rb.make_rect(f"{prefix}-bg", x, y, w, card_h, fid, fid, fill="#0D0D0D", stroke="#333333", rx=14))
        kids.append(rb.make_rect(f"{prefix}-pill", x + 14, y + 12, 110, 20, fid, fid, fill="#1A1A1A", stroke="#555555", rx=6))
        kids.append(
            rb.make_text(f"{prefix}-st", x + 14, y + 14, 110, 16, fid, fid, status, size=10, color=CAPTION, align="center")
        )
        kids.append(
            rb.make_text(f"{prefix}-amt", x + 14, y + 42, w - 28, 28, fid, fid, amount, size=22, weight="700")
        )
        yy = y + 74
        if fiat:
            kids.append(rb.make_text(f"{prefix}-fiat", x + 14, yy, w - 28, 16, fid, fid, fiat, size=11, color=CAPTION))
            yy += 18
        if memo:
            kids.append(rb.make_text(f"{prefix}-memo", x + 14, yy, w - 28, 16, fid, fid, memo, size=11, color=HINT))
        kids.append(
            rb.make_text(
                f"{prefix}-tm", x + 14, y + card_h - 22, w - 28, 14, fid, fid, time, size=10, color="#666666", align="right"
            )
        )
    return kids, card_h


def action_bar(ox, oy, fid, y):
    """Request (ghost) + Send (white) — Revolut dual CTA, Basic styling."""
    kids = []
    kids.append(rb.make_rect("req", ox + 28, y, 160, 44, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=10))
    kids.append(
        rb.make_text("req-l", ox + 28, y + 12, 160, 22, fid, fid, "← Request", size=13, weight="700", align="center")
    )
    kids.append(rb.make_rect("send", ox + 202, y, 160, 44, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text(
            "send-l", ox + 202, y + 12, 160, 22, fid, fid, "Send →", size=13, color="#000000", weight="700", align="center"
        )
    )
    return kids


def composer(ox, oy, fid, y, placeholder="Type a message…"):
    kids = []
    kids.append(rb.make_rect("composer", ox + 28, y, 334, 44, fid, fid, fill="#111111", stroke="#555555", rx=10))
    kids.append(rb.make_text("comp-ph", ox + 44, y + 12, 280, 22, fid, fid, placeholder, size=13, color="#595959"))
    return kids


def sheet_chrome(ox, oy, fid, sheet_h: int):
    kids = []
    kids.append(rb.make_rect("scrim", ox, oy, PHONE_W, PHONE_H, fid, fid, fill="#000000", stroke=None, rx=28))
    kids[-1]["opacity"] = 0.55
    top = oy + PHONE_H - sheet_h
    kids.append(rb.make_rect("sheet", ox, top, PHONE_W, sheet_h, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=20))
    kids.append(rb.make_rect("grab", ox + 165, top + 10, 60, 4, fid, fid, fill="#555555", stroke=None, rx=2))
    return kids, top


# --- boards ------------------------------------------------------------------

def build_15_thread(ox, oy):
    fr = rb.make_frame("15 Pay in Chat", ox, oy)
    fid = fr["id"]
    kids = []
    kids += chat_header(ox, oy, fid, name="Alice", handle="npub1…alice")
    kids.append(date_divider(ox, oy, fid, "Today", oy + 128))

    y = oy + 156
    bub, h = text_bubble(ox, oy, fid, "t1", "Dinner was great — thanks!", y, outgoing=False, w=240)
    kids += bub
    y += h + 12

    pay, h = pay_card(
        ox,
        oy,
        fid,
        "p1",
        status="You sent",
        amount="50,000 sats",
        fiat="≈ EUR 24.30",
        memo="For dinner",
        time="15:55",
        outgoing=True,
        y=y,
        card_h=126,
    )
    kids += pay
    y += h + 12

    bub, h = text_bubble(ox, oy, fid, "t2", "Thank you!", y, outgoing=False, w=120)
    kids += bub
    y += h + 12

    pay, h = pay_card(
        ox,
        oy,
        fid,
        "p2",
        status="You received",
        amount="12,000 sats",
        fiat="≈ EUR 5.83",
        memo="Coffee",
        time="16:02",
        outgoing=False,
        y=y,
        card_h=126,
    )
    kids += pay

    kids += action_bar(ox, oy, fid, oy + 720)
    kids += composer(ox, oy, fid, oy + 776)
    return fr, kids


def build_15b_send_amount(ox, oy):
    fr = rb.make_frame("15b Send amount", ox, oy)
    fid = fr["id"]
    kids = []
    # faded thread under sheet
    kids += chat_header(ox, oy, fid, name="Alice", handle="npub1…alice")
    kids.append(date_divider(ox, oy, fid, "Today", oy + 128))
    pay, _ = pay_card(
        ox,
        oy,
        fid,
        "bg-p",
        status="You sent",
        amount="50,000 sats",
        fiat="≈ EUR 24.30",
        memo="For dinner",
        time="15:55",
        outgoing=True,
        y=oy + 156,
        card_h=110,
    )
    kids += pay

    sheet, top = sheet_chrome(ox, oy, fid, 420)
    kids += sheet
    kids.append(
        rb.make_text("stitle", ox + 40, top + 28, 310, 24, fid, fid, "SEND TO ALICE", size=16, weight="700", align="center")
    )
    kids.append(
        rb.make_text("ssub", ox + 40, top + 54, 310, 18, fid, fid, "From Personal · ark", size=11, color=CAPTION, align="center")
    )
    kids.append(rb.make_text("la", ox + 40, top + 96, 120, 16, fid, fid, "amount", size=12, color="#8C8C8C"))
    kids.append(rb.make_rect("fa", ox + 28, top + 116, 334, 56, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=10))
    kids.append(rb.make_text("va", ox + 42, top + 130, 300, 28, fid, fid, "21,000 sats", size=20, weight="700"))
    kids.append(
        rb.make_text("fiat", ox + 40, top + 184, 310, 18, fid, fid, "≈ EUR 10.21 · USD 11.02", size=12, color=CAPTION, align="center")
    )
    kids.append(rb.make_text("lm", ox + 40, top + 220, 120, 16, fid, fid, "memo", size=12, color="#8C8C8C"))
    kids.append(rb.make_rect("fm", ox + 28, top + 240, 334, 48, fid, fid, fill="#0D0D0D", stroke="#555555", rx=10))
    kids.append(rb.make_text("vm", ox + 42, top + 254, 300, 22, fid, fid, "optional note", size=13, color=HINT))
    kids.append(rb.make_rect("cta", ox + 28, top + 320, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text("ctal", ox + 28, top + 334, 334, 24, fid, fid, "Continue", size=15, color="#000000", weight="700", align="center")
    )
    return fr, kids


def build_15c_request(ox, oy):
    fr = rb.make_frame("15c Request", ox, oy)
    fid = fr["id"]
    kids = []
    kids += chat_header(ox, oy, fid, name="Alice", handle="npub1…alice")
    kids.append(
        rb.make_text(
            "hint",
            ox + 40,
            oy + 200,
            310,
            40,
            fid,
            fid,
            "Ask Alice for a receive address\nvia encrypted Nostr request",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    sheet, top = sheet_chrome(ox, oy, fid, 400)
    kids += sheet
    kids.append(
        rb.make_text("stitle", ox + 40, top + 28, 310, 24, fid, fid, "REQUEST", size=16, weight="700", align="center")
    )
    kids.append(
        rb.make_text("ssub", ox + 40, top + 54, 310, 18, fid, fid, "NIP-17 gift wrap · Bitcoin only", size=11, color=CAPTION, align="center")
    )
    kids.append(rb.make_text("la", ox + 40, top + 96, 120, 16, fid, fid, "amount", size=12, color="#8C8C8C"))
    kids.append(rb.make_rect("fa", ox + 28, top + 116, 334, 56, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", rx=10))
    kids.append(rb.make_text("va", ox + 42, top + 130, 300, 28, fid, fid, "21,000 sats", size=20, weight="700"))
    kids.append(rb.make_text("lm", ox + 40, top + 190, 120, 16, fid, fid, "memo", size=12, color="#8C8C8C"))
    kids.append(rb.make_rect("fm", ox + 28, top + 210, 334, 48, fid, fid, fill="#0D0D0D", stroke="#555555", rx=10))
    kids.append(rb.make_text("vm", ox + 42, top + 224, 300, 22, fid, fid, "Rent share", size=13))
    kids.append(rb.make_rect("cta", ox + 28, top + 290, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text(
            "ctal", ox + 28, top + 304, 334, 24, fid, fid, "Send request", size=15, color="#000000", weight="700", align="center"
        )
    )
    return fr, kids


def build_15d_slide(ox, oy):
    fr = rb.make_frame("15d Slide confirm", ox, oy)
    fid = fr["id"]
    kids = []
    kids += chat_header(ox, oy, fid, name="Alice", handle="npub1…alice")
    pay, _ = pay_card(
        ox,
        oy,
        fid,
        "bg-p",
        status="You received",
        amount="12,000 sats",
        fiat="≈ EUR 5.83",
        memo="Coffee",
        time="16:02",
        outgoing=False,
        y=oy + 150,
        card_h=110,
    )
    kids += pay

    sheet, top = sheet_chrome(ox, oy, fid, 340)
    kids += sheet
    kids.append(
        rb.make_text("stitle", ox + 40, top + 28, 310, 24, fid, fid, "CONFIRM SEND", size=16, weight="700", align="center")
    )
    kids.append(
        rb.make_text("amt", ox + 40, top + 70, 310, 32, fid, fid, "21,000 sats", size=24, weight="700", align="center")
    )
    kids.append(
        rb.make_text("to", ox + 40, top + 108, 310, 18, fid, fid, "to Alice · ark…", size=12, color=CAPTION, align="center")
    )
    kids.append(
        rb.make_text("fee", ox + 40, top + 132, 310, 16, fid, fid, "network fee included", size=11, color=HINT, align="center")
    )
    kids += rb.elastic_slider(ox + 28, top + 200, fid, fid, progress=0.35, label="slide to send", label_color="#FFFFFF")
    return fr, kids


def build_15e_incoming(ox, oy):
    fr = rb.make_frame("15e Incoming request", ox, oy)
    fid = fr["id"]
    kids = []
    kids += chat_header(ox, oy, fid, name="Alice", handle="npub1…alice")
    kids.append(date_divider(ox, oy, fid, "Today", oy + 128))

    y = oy + 156
    bub, h = text_bubble(ox, oy, fid, "t1", "Can you cover rent?", y, outgoing=False, w=200)
    kids += bub
    y += h + 14

    # Incoming request card (left) with actions
    w, card_h = 280, 168
    x = ox + 28
    kids.append(rb.make_rect("req-bg", x, y, w, card_h, fid, fid, fill="#0D0D0D", stroke="#FFFFFF", sw=1.5, rx=14))
    kids.append(rb.make_rect("req-pill", x + 14, y + 12, 130, 20, fid, fid, fill="#1A1A1A", stroke="#555555", rx=6))
    kids.append(
        rb.make_text("req-st", x + 14, y + 14, 130, 16, fid, fid, "Request · pending", size=10, color=CAPTION, align="center")
    )
    kids.append(rb.make_text("req-amt", x + 14, y + 42, w - 28, 28, fid, fid, "21,000 sats", size=22, weight="700"))
    kids.append(rb.make_text("req-fiat", x + 14, y + 74, w - 28, 16, fid, fid, "≈ EUR 10.21 · Rent share", size=11, color=CAPTION))
    kids.append(rb.make_rect("decline", x + 14, y + 108, 118, 40, fid, fid, fill="#111111", stroke="#555555", rx=10))
    kids.append(
        rb.make_text("decl-l", x + 14, y + 118, 118, 22, fid, fid, "Decline", size=13, color=CAPTION, align="center")
    )
    kids.append(rb.make_rect("pay", x + 148, y + 108, 118, 40, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text("pay-l", x + 148, y + 118, 118, 22, fid, fid, "Pay", size=13, color="#000000", weight="700", align="center")
    )

    kids += action_bar(ox, oy, fid, oy + 720)
    kids += composer(ox, oy, fid, oy + 776)
    return fr, kids


def build_15f_empty(ox, oy):
    fr = rb.make_frame("15f Empty thread", ox, oy)
    fid = fr["id"]
    kids = []
    kids += chat_header(ox, oy, fid, name="Bob", handle="lnurl1…bob")
    kids += rb.contact_initial_avatar(ox + 195, oy + 280, 28, "B", fid, fid)
    kids.append(
        rb.make_text("empty", ox + 40, oy + 340, 310, 24, fid, fid, "No messages yet", size=15, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "empty-sub",
            ox + 40,
            oy + 372,
            310,
            48,
            fid,
            fid,
            "Private chat with Bob.\nEncrypted with your account data.\nSend or request sats anytime.",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids += action_bar(ox, oy, fid, oy + 720)
    kids += composer(ox, oy, fid, oy + 776)
    return fr, kids


# --- contact list + amount keypad + asset picker -----------------------------

FICTIONAL_CONTACTS = [
    ("A", "Alice", "You sent 50,000 sats", "Today", True),
    ("B", "Bob", "Sent you 12,000 sats", "Yesterday", False),
    ("C", "Carol", "Request · 21,000 sats", "Sep 12", True),
    ("D", "Dave", "You sent 100,000 sats", "Sep 8", False),
    ("E", "Eve", "No payments yet", "—", False),
    ("F", "Frank", "Sent you 5,000 sats", "Aug 31", False),
]


def keypad(ox, oy, fid, y0):
    """3×4 numeric pad — Basic outlined keys."""
    kids = []
    keys = [
        ("1", "2", "3"),
        ("4", "5", "6"),
        ("7", "8", "9"),
        (".", "0", "⌫"),
    ]
    kw, kh, gap = 102, 48, 8
    for r, row in enumerate(keys):
        for c, lab in enumerate(row):
            x = ox + 28 + c * (kw + gap)
            y = y0 + r * (kh + gap)
            kids.append(
                rb.make_rect(f"k-{r}{c}", x, y, kw, kh, fid, fid, fill="#0D0D0D", stroke="#333333", rx=10)
            )
            kids.append(
                rb.make_text(f"kl-{r}{c}", x, y + 14, kw, 22, fid, fid, lab, size=18, weight="700", align="center")
            )
    return kids


def amount_header(ox, oy, fid, *, name="Alice", handle="npub1…alice"):
    kids = []
    kids += rb.logo(ox + 150, oy + 36, fid, fid, 0.55)
    kids += rb.contact_initial_avatar(ox + 348, oy + 86, 15, name[0], fid, fid)
    kids.append(rb.make_text("to-n", ox + 48, oy + 72, 250, 20, fid, fid, name, size=15, weight="700", align="center"))
    kids.append(
        rb.make_text("to-h", ox + 48, oy + 94, 250, 16, fid, fid, handle, size=11, color=CAPTION, align="center")
    )
    return kids


def build_15g_choose_contact(ox, oy):
    fr = rb.make_frame("15g Choose contact", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        rb.make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "PAY", size=20, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            18,
            fid,
            fid,
            "Pick a contact to chat or send",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(rb.make_rect("search", ox + 28, oy + 168, 278, 44, fid, fid, fill="#111111", stroke="#555555", rx=10))
    kids.append(rb.make_text("sq", ox + 44, oy + 180, 240, 22, fid, fid, "Search…", size=13, color="#595959"))
    kids.append(rb.make_rect("add", ox + 318, oy + 168, 44, 44, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(rb.make_text("add-l", ox + 318, oy + 178, 44, 24, fid, fid, "+", size=20, color="#000000", weight="700", align="center"))

    for i, (letter, name, sub, date, unread) in enumerate(FICTIONAL_CONTACTS):
        yy = oy + 232 + i * 78
        kids.append(rb.make_rect(f"row-{i}", ox + 28, yy, 334, 70, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids += rb.contact_initial_avatar(ox + 58, yy + 35, 18, letter, fid, fid)
        kids.append(rb.make_text(f"n-{i}", ox + 88, yy + 12, 180, 20, fid, fid, name, size=14, weight="700"))
        kids.append(rb.make_text(f"s-{i}", ox + 88, yy + 36, 200, 18, fid, fid, sub, size=11, color=CAPTION))
        kids.append(rb.make_text(f"d-{i}", ox + 260, yy + 14, 88, 16, fid, fid, date, size=10, color=HINT, align="right"))
        if unread:
            kids.append(rb.make_rect(f"badge-{i}", ox + 330, yy + 38, 18, 18, fid, fid, fill="#FFFFFF", stroke=None, rx=9))
            kids.append(
                rb.make_text(f"bn-{i}", ox + 330, yy + 40, 18, 14, fid, fid, "1", size=10, color="#000000", weight="700", align="center")
            )
    return fr, kids


def _build_amount_screen(ox, oy, frame_name, *, amount: str, fiat: str | None, send_enabled: bool, asset_pill: str):
    fr = rb.make_frame(frame_name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += amount_header(ox, oy, fid, name="Alice", handle="npub1…alice")

    kids.append(
        rb.make_text("amt", ox + 28, oy + 130, 334, 48, fid, fid, amount, size=36, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "fee",
            ox + 28,
            oy + 180,
            334,
            16,
            fid,
            fid,
            fiat if fiat else "No network fee preview yet",
            size=11,
            color=CAPTION,
            align="center",
        )
    )

    # Asset / balance pill (tap → 15j)
    kids.append(rb.make_rect("asset-pill", ox + 70, oy + 210, 250, 36, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=18))
    kids.append(
        rb.make_text("asset-l", ox + 70, oy + 218, 250, 22, fid, fid, asset_pill, size=12, weight="700", align="center")
    )
    kids.append(
        rb.make_text("asset-hint", ox + 28, oy + 252, 334, 14, fid, fid, "tap to change asset", size=10, color=HINT, align="center")
    )

    kids.append(rb.make_rect("note", ox + 28, oy + 278, 334, 44, fid, fid, fill="#0D0D0D", stroke="#555555", rx=10))
    kids.append(rb.make_text("note-ph", ox + 44, oy + 290, 280, 22, fid, fid, "Add note", size=13, color="#595959"))

    # Quick presets
    presets = ["10k", "21k", "50k", "100k"]
    for i, p in enumerate(presets):
        xx = ox + 28 + i * 86
        kids.append(rb.make_rect(f"pre-{i}", xx, oy + 336, 78, 32, fid, fid, fill="#111111", stroke="#555555", rx=8))
        kids.append(rb.make_text(f"prel-{i}", xx, oy + 342, 78, 20, fid, fid, p, size=12, color=CAPTION, align="center"))

    # Send CTA
    if send_enabled:
        kids.append(rb.make_rect("send", ox + 28, oy + 384, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
        kids.append(
            rb.make_text("send-l", ox + 28, oy + 398, 334, 24, fid, fid, "Send", size=16, color="#000000", weight="700", align="center")
        )
    else:
        kids.append(rb.make_rect("send", ox + 28, oy + 384, 334, 48, fid, fid, fill="#1A1A1A", stroke="#333333", rx=10))
        kids.append(
            rb.make_text("send-l", ox + 28, oy + 398, 334, 24, fid, fid, "Send", size=16, color="#555555", weight="700", align="center")
        )

    kids += keypad(ox, oy, fid, oy + 452)
    return fr, kids


def build_15h_amount(ox, oy):
    return _build_amount_screen(
        ox,
        oy,
        "15h Amount",
        amount="0 sats",
        fiat=None,
        send_enabled=False,
        asset_pill="Bitcoin · 1,234,567 sats",
    )


def build_15i_amount_ready(ox, oy):
    return _build_amount_screen(
        ox,
        oy,
        "15i Amount ready",
        amount="21,000 sats",
        fiat="≈ EUR 10.21 · USD 11.02",
        send_enabled=True,
        asset_pill="Bitcoin · 1,234,567 sats",
    )


def build_15j_choose_asset(ox, oy):
    fr = rb.make_frame("15j Choose asset", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(
        rb.make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "ASSET", size=20, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "sub",
            ox + 40,
            oy + 132,
            310,
            18,
            fid,
            fid,
            "What to send Alice",
            size=12,
            color=CAPTION,
            align="center",
        )
    )

    # Quick chips
    chips = [("BTC", True), ("USDT", False), ("EUR*", False)]
    for i, (lab, on) in enumerate(chips):
        xx = ox + 28 + i * 112
        kids.append(
            rb.make_rect(
                f"chip-{i}",
                xx,
                oy + 168,
                104,
                36,
                fid,
                fid,
                fill="#FFFFFF" if on else "#111111",
                stroke=None if on else "#555555",
                rx=18,
            )
        )
        kids.append(
            rb.make_text(
                f"chipl-{i}",
                xx,
                oy + 176,
                104,
                22,
                fid,
                fid,
                lab,
                size=13,
                color="#000000" if on else CAPTION,
                weight="700",
                align="center",
            )
        )
    kids.append(
        rb.make_text(
            "chip-hint",
            ox + 28,
            oy + 216,
            334,
            16,
            fid,
            fid,
            "Payment will be sent as Bitcoin",
            size=11,
            color=CAPTION,
            align="center",
        )
    )

    kids.append(rb.make_text("sec", ox + 28, oy + 250, 200, 18, fid, fid, "Personal balances", size=12, color="#8C8C8C"))

    assets = [
        ("₿", "Bitcoin", "1,234,567 sats", True),
        ("T", "USDT", "250.00 USDT", False),
        ("€", "EUR stablecoin", "80.00 EURx", False),
    ]
    for i, (glyph, name, bal, sel) in enumerate(assets):
        yy = oy + 280 + i * 88
        kids.append(
            rb.make_rect(
                f"a-{i}",
                ox + 28,
                yy,
                334,
                76,
                fid,
                fid,
                fill="#1A1A1A" if sel else "#0D0D0D",
                stroke="#FFFFFF" if sel else "#333333",
                rx=12,
            )
        )
        kids.append(rb.make_rect(f"av-{i}", ox + 44, yy + 18, 40, 40, fid, fid, fill="#111111", stroke="#555555", rx=20))
        kids.append(
            rb.make_text(f"ag-{i}", ox + 44, yy + 28, 40, 22, fid, fid, glyph, size=16, weight="700", align="center")
        )
        kids.append(rb.make_text(f"an-{i}", ox + 98, yy + 18, 160, 22, fid, fid, name, size=14, weight="700"))
        kids.append(rb.make_text(f"ab-{i}", ox + 98, yy + 42, 200, 18, fid, fid, bal, size=12, color=CAPTION))
        if sel:
            kids.append(rb.make_text(f"chk-{i}", ox + 310, yy + 26, 30, 24, fid, fid, "✓", size=16, weight="700", align="center"))

    kids.append(
        rb.make_text(
            "foot",
            ox + 28,
            oy + 560,
            334,
            32,
            fid,
            fid,
            "EUR* = EUR-based stablecoin (future).\nBalances from selected wallet (Personal).",
            size=11,
            color=HINT,
            align="center",
        )
    )
    kids.append(rb.make_rect("done", ox + 28, oy + 720, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text("donel", ox + 28, oy + 734, 334, 24, fid, fid, "Done", size=16, color="#000000", weight="700", align="center")
    )
    return fr, kids


BUILDERS = [
    ("15 Pay in Chat", build_15_thread),
    ("15b Send amount", build_15b_send_amount),
    ("15c Request", build_15c_request),
    ("15d Slide confirm", build_15d_slide),
    ("15e Incoming request", build_15e_incoming),
    ("15f Empty thread", build_15f_empty),
    ("15g Choose contact", build_15g_choose_contact),
    ("15h Amount", build_15h_amount),
    ("15i Amount ready", build_15i_amount_ready),
    ("15j Choose asset", build_15j_choose_asset),
]


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


def layout_pos(i):
    col = i % 3
    row = i // 3
    return ORIGIN_X + col * COL, ORIGIN_Y + row * ROW


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][p]["name"]: p for p in meta["data"]["pages"]}
    print("existing pages:", list(pages.keys()))
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
    for i, (name, builder) in enumerate(BUILDERS):
        ox, oy = layout_pos(i)
        fr, kids = builder(ox, oy)
        boards[name] = (fr, kids)
        print(f"  build {name} @ ({ox},{oy})")

    changes = []
    for name, _ in reversed(BUILDERS):
        fr, kids = boards[name]
        finish(changes, fr, kids, page_id)

    # yellow notes above each board
    for i, (name, _) in enumerate(BUILDERS):
        ox, oy = layout_pos(i)
        title, body = SCENE_NOTES[name]
        note_h = note_height(body)
        note_y = oy - note_h - 24
        note_changes, _ = make_note(page_id, title, body, ox, note_y)
        changes.extend(note_changes)

    print(f"pushing {len(changes)} changes")
    revn, vern = push(c, revn, vern, changes, chunk=40)
    print(f"done revn={revn} vern={vern} page={PAGE_NAME} ({page_id})")


if __name__ == "__main__":
    main()
