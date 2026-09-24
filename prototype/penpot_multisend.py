#!/usr/bin/env python3
"""Add Penpot page «Multisend» — one tx, N Ark recipients (feasibility approach A).

Boards:
  16 Multisend empty · 16b Two recipients · 16c Three recipients
  16d Add recipient sheet · 16e Confirm slide · 16f Success · 16g Dust bump

Visual system matches penpot_rebuild_clean / current Expo Send
(Enter · Paste · My wallets, black canvas, JetBrains Mono).
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

PAGE_NAME = "Multisend"
PHONE_W, PHONE_H = 390, 844
COL, ROW = 460, 1040
ORIGIN_X, ORIGIN_Y = 40, 360
NOTE_W = 390
CAPTION = "#B3B3B3"
HINT = "#999999"

_spec = importlib.util.spec_from_file_location(
    "rebuild", Path(__file__).with_name("penpot_rebuild_clean.py")
)
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

ARK_A = rb.mid_ellipsis(rb.DEMO_ARK, 10, 6)
ARK_B = rb.mid_ellipsis("ark1qsavingsxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", 10, 6)
ARK_C = rb.mid_ellipsis("ark1qalicezzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", 10, 6)

SCENE_NOTES: dict[str, tuple[str, str]] = {
    "16 Multisend empty": (
        "16 Multisend empty",
        "Send extended for N Ark recipients (one wallet.send).\n\n"
        "Same chrome as Expo Send: balance, Amount, To with Enter · Paste · My wallets, "
        "scan QR when empty.\n\n"
        "Ghost «+ Add recipient» appears under the first row. Disabled until the first "
        "destination + amount are valid (or always visible but Confirm needs ≥1 complete row).\n\n"
        "Lightning path unchanged: if To is BOLT11, hide Add recipient.",
    ),
    "16b Two recipients": (
        "16b Two recipients",
        "Approach A from multi-send plan: stacked recipient cards.\n\n"
        "Each card = label (My wallet / paste) + truncated ark… + amount + Clear/×.\n\n"
        "Footer shows Total = sum. Confirm send enabled when every row ≥ dust and "
        "total ≤ spendable.\n\n"
        "Tap + Add recipient → 16d sheet (fills a new card).",
    ),
    "16c Three recipients": (
        "16c Three recipients",
        "Denser list (max soft-cap ~10). Cards stay compact (~72px).\n\n"
        "If list exceeds viewport, scroll the middle; keep Total + Confirm pinned "
        "above the home indicator.\n\n"
        "Duplicate addresses: warn or merge amounts on confirm (product choice).",
    ),
    "16d Add recipient sheet": (
        "16d Add recipient sheet",
        "Half-height InteractiveBottomSheet (same as Enter / My wallets today).\n\n"
        "Actions: Enter address · Paste · My wallets. Optional amount field in-sheet "
        "or fill amount on the new card after pick.\n\n"
        "avoidKeyboard when Enter is open. No auto-focus until sheet opens.",
    ),
    "16e Confirm slide": (
        "16e Confirm slide",
        "One presence / slide for the whole batch — never N confirms.\n\n"
        "Summary: N recipients · total sats · short list (label + amount). "
        "Release → single wallet.send({ recipients: […] }).",
    ),
    "16f Success": (
        "16f Success",
        "FundsSent overlay: total primary, «to N addresses» caption.\n\n"
        "Recipient rows for review; View details → Activity with same txid "
        "and full (address, amount) list.\n\n"
        "One txid for all outputs.",
    ),
    "16g Dust bump": (
        "16g Dust bump",
        "Change would be below ASP dust → bump the last (or largest) row.\n\n"
        "Dialog shows original vs adjusted amount on that line; total updates. "
        "Same prepareDustSafeSend logic as single-send, but paymentSum = Σ amounts.",
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
    return max(160, min(400, 54 + lines * 16))


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


# --- chrome helpers ----------------------------------------------------------

def send_header(ox, oy, fid, *, balance="1,234,567 sats"):
    kids = []
    kids += rb.logo(ox + 150, oy + 40, fid, fid, 0.77)
    kids.append(rb.make_text("title", ox + 40, oy + 92, 310, 26, fid, fid, "SEND", size=20, weight="700", align="center"))
    kids.append(rb.make_text("bal", ox + 40, oy + 128, 310, 32, fid, fid, balance, size=26, weight="700", align="center"))
    kids.append(
        rb.make_text(
            "net",
            ox + 40,
            oy + 162,
            310,
            18,
            fid,
            fid,
            "Arkade → ark… · mainnet",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    return kids


def to_actions(ox, oy, fid, y, *, show_my=True):
    kids = []
    labels = [("Enter", "⌨"), ("Paste", "📋")]
    if show_my:
        labels.append(("My wallets", "⌂"))
    n = len(labels)
    gap = 10
    w = (334 - gap * (n - 1)) // n
    for i, (lab, glyph) in enumerate(labels):
        xx = ox + 28 + i * (w + gap)
        kids.append(rb.make_rect(f"act-{i}", xx, y, w, 64, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
        kids.append(
            rb.make_text(f"actg-{i}", xx, y + 12, w, 20, fid, fid, glyph, size=14, color="#FFFFFF", align="center")
        )
        kids.append(
            rb.make_text(f"actl-{i}", xx, y + 36, w, 18, fid, fid, lab, size=11, color=CAPTION, align="center")
        )
    return kids


def recipient_card(
    ox,
    oy,
    fid,
    prefix,
    y,
    *,
    label: str | None,
    address: str,
    amount: str,
    h: int = 78,
):
    kids = []
    kids.append(rb.make_rect(f"{prefix}-bg", ox + 28, y, 334, h, fid, fid, fill="#0D0D0D", stroke="#333333", rx=12))
    if label:
        kids.append(
            rb.make_text(f"{prefix}-lab", ox + 44, y + 10, 240, 16, fid, fid, label, size=11, color=CAPTION)
        )
        kids.append(rb.make_text(f"{prefix}-addr", ox + 44, y + 28, 240, 18, fid, fid, address, size=12))
    else:
        kids.append(rb.make_text(f"{prefix}-addr", ox + 44, y + 14, 240, 18, fid, fid, address, size=12))
    kids.append(
        rb.make_text(
            f"{prefix}-amt",
            ox + 44,
            y + (48 if label else 38),
            200,
            20,
            fid,
            fid,
            amount,
            size=14,
            weight="700",
        )
    )
    kids.append(
        rb.make_text(f"{prefix}-x", ox + 310, y + 28, 36, 22, fid, fid, "×", size=18, color=HINT, align="center")
    )
    return kids, h


def add_recipient_btn(ox, oy, fid, y, *, enabled=True):
    kids = []
    stroke = "#FFFFFF" if enabled else "#333333"
    color = "#FFFFFF" if enabled else "#555555"
    kids.append(rb.make_rect("add", ox + 28, y, 334, 44, fid, fid, fill="#111111", stroke=stroke, sw=1.5, rx=10))
    kids.append(
        rb.make_text("addl", ox + 28, y + 12, 334, 22, fid, fid, "+ Add recipient", size=14, color=color, align="center")
    )
    return kids


def total_bar(ox, oy, fid, y, total: str):
    kids = []
    kids.append(rb.make_text("tot-l", ox + 28, y, 140, 20, fid, fid, "Total", size=13, color=CAPTION))
    kids.append(
        rb.make_text("tot-v", ox + 160, y, 202, 20, fid, fid, total, size=14, weight="700", align="right")
    )
    return kids


def confirm_btn(ox, oy, fid, y, *, enabled=True, label="Confirm send"):
    kids = []
    if enabled:
        kids.append(rb.make_rect("cfm", ox + 28, y, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
        kids.append(
            rb.make_text(
                "cfml", ox + 28, y + 14, 334, 24, fid, fid, label, size=15, color="#000000", weight="700", align="center"
            )
        )
    else:
        kids.append(rb.make_rect("cfm", ox + 28, y, 334, 48, fid, fid, fill="#1A1A1A", stroke="#333333", rx=10))
        kids.append(
            rb.make_text("cfml", ox + 28, y + 14, 334, 24, fid, fid, label, size=15, color="#555555", align="center")
        )
    return kids


def scan_fab(ox, oy, fid):
    kids = []
    d = 72
    cx, cy = ox + 195, oy + 720
    kids.append(
        rb.make_rect(
            "scan-circle",
            cx - d / 2,
            cy - d / 2,
            d,
            d,
            fid,
            fid,
            fill="#111111",
            stroke="#FFFFFF",
            sw=2,
            rx=d / 2,
        )
    )
    kids.append(rb.camera_lens(cx, cy - 2, fid, fid))
    kids.append(rb.make_text("scan", cx - 40, cy + 44, 80, 18, fid, fid, "scan QR", size=11, color=CAPTION, align="center"))
    return kids


def sheet_chrome(ox, oy, fid, sheet_h: int):
    kids = []
    kids.append(rb.make_rect("scrim", ox, oy, PHONE_W, PHONE_H, fid, fid, fill="#000000", stroke=None, rx=28))
    kids[-1]["opacity"] = 0.55
    top = oy + PHONE_H - sheet_h
    kids.append(
        rb.make_rect("sheet", ox, top, PHONE_W, sheet_h, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=20)
    )
    kids.append(rb.make_rect("grab", ox + 165, top + 10, 60, 4, fid, fid, fill="#555555", stroke=None, rx=2))
    return kids, top


# --- boards ------------------------------------------------------------------

def build_16_empty(ox, oy):
    fr = rb.make_frame("16 Multisend empty", ox, oy)
    fid = fr["id"]
    kids = []
    kids += send_header(ox, oy, fid)
    kids.append(rb.make_text("l-amt", ox + 28, oy + 200, 200, 16, fid, fid, "Amount (sats)", size=12, color=CAPTION))
    kids.append(rb.make_text("max", ox + 250, oy + 200, 112, 16, fid, fid, "Max send", size=12, color=HINT, align="right"))
    kids.append(rb.make_rect("f-amt", ox + 28, oy + 220, 334, 48, fid, fid, rx=10))
    kids.append(rb.make_text("ph-amt", ox + 42, oy + 234, 280, 24, fid, fid, "0", size=14, color=HINT))

    kids.append(rb.make_text("l-to", ox + 28, oy + 286, 100, 16, fid, fid, "To:", size=12, color=CAPTION))
    kids += to_actions(ox, oy, fid, oy + 308, show_my=True)

    kids += add_recipient_btn(ox, oy, fid, oy + 392, enabled=False)
    kids.append(
        rb.make_text(
            "hint",
            ox + 28,
            oy + 448,
            334,
            36,
            fid,
            fid,
            "Add recipient unlocks after the first\nark… destination is set.",
            size=11,
            color=HINT,
            align="center",
        )
    )
    kids += confirm_btn(ox, oy, fid, oy + 500, enabled=False)
    kids += scan_fab(ox, oy, fid)
    return fr, kids


def build_16b_two(ox, oy):
    fr = rb.make_frame("16b Two recipients", ox, oy)
    fid = fr["id"]
    kids = []
    kids += send_header(ox, oy, fid)
    kids.append(rb.make_text("sec", ox + 28, oy + 198, 200, 18, fid, fid, "Recipients", size=12, color="#8C8C8C"))

    y = oy + 222
    c, h = recipient_card(
        ox, oy, fid, "r0", y, label="My wallet · Savings", address=ARK_B, amount="25,000 sats"
    )
    kids += c
    y += h + 10
    c, h = recipient_card(ox, oy, fid, "r1", y, label=None, address=ARK_A, amount="50,000 sats")
    kids += c
    y += h + 14

    kids += add_recipient_btn(ox, oy, fid, y, enabled=True)
    y += 56
    kids += total_bar(ox, oy, fid, y, "75,000 sats")
    y += 36
    kids.append(
        rb.make_text("fee", ox + 28, y, 334, 16, fid, fid, "One Arkade tx · network fee in round", size=11, color=HINT)
    )
    kids += confirm_btn(ox, oy, fid, oy + 560, enabled=True)
    return fr, kids


def build_16c_three(ox, oy):
    fr = rb.make_frame("16c Three recipients", ox, oy)
    fid = fr["id"]
    kids = []
    kids += send_header(ox, oy, fid, balance="1,234,567 sats")
    kids.append(rb.make_text("sec", ox + 28, oy + 198, 220, 18, fid, fid, "Recipients · 3", size=12, color="#8C8C8C"))

    rows = [
        ("My wallet · Savings", ARK_B, "10,000 sats"),
        ("My wallet · Travel", ARK_A, "20,000 sats"),
        (None, ARK_C, "5,000 sats"),
    ]
    y = oy + 220
    for i, (lab, addr, amt) in enumerate(rows):
        c, h = recipient_card(ox, oy, fid, f"r{i}", y, label=lab, address=addr, amount=amt, h=72)
        kids += c
        y += h + 8

    kids += add_recipient_btn(ox, oy, fid, y, enabled=True)
    y += 52
    kids += total_bar(ox, oy, fid, y, "35,000 sats")
    kids += confirm_btn(ox, oy, fid, oy + 620, enabled=True)
    kids.append(
        rb.make_text(
            "cap",
            ox + 28,
            oy + 684,
            334,
            32,
            fid,
            fid,
            "Soft cap 10 recipients. Scroll list if needed;\nTotal + Confirm stay pinned.",
            size=11,
            color=HINT,
            align="center",
        )
    )
    return fr, kids


def build_16d_sheet(ox, oy):
    fr = rb.make_frame("16d Add recipient sheet", ox, oy)
    fid = fr["id"]
    kids = []
    # dimmed send behind
    kids += send_header(ox, oy, fid)
    kids.append(rb.make_text("sec", ox + 28, oy + 198, 200, 18, fid, fid, "Recipients", size=12, color="#8C8C8C"))
    c, _ = recipient_card(
        ox, oy, fid, "r0", oy + 222, label="My wallet · Savings", address=ARK_B, amount="25,000 sats"
    )
    kids += c

    sheet_kids, top = sheet_chrome(ox, oy, fid, 420)
    kids += sheet_kids
    kids.append(
        rb.make_text(
            "sht",
            ox + 40,
            top + 28,
            310,
            24,
            fid,
            fid,
            "Add recipient",
            size=16,
            weight="700",
            align="center",
        )
    )
    kids.append(
        rb.make_text(
            "shsub",
            ox + 40,
            top + 56,
            310,
            18,
            fid,
            fid,
            "Same pickers as To:",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids += to_actions(ox, oy, fid, top + 90, show_my=True)

    kids.append(rb.make_text("l-amt", ox + 28, top + 174, 200, 16, fid, fid, "Amount (optional)", size=12, color=CAPTION))
    kids.append(rb.make_rect("f-amt", ox + 28, top + 194, 334, 48, fid, fid, rx=10))
    kids.append(rb.make_text("ph", ox + 42, top + 208, 280, 24, fid, fid, "enter sats or fill later", size=13, color=HINT))

    kids.append(rb.make_rect("done", ox + 28, top + 270, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text(
            "donel",
            ox + 28,
            top + 284,
            334,
            24,
            fid,
            fid,
            "Add",
            size=15,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    kids.append(
        rb.make_text("cancel", ox + 28, top + 336, 334, 20, fid, fid, "Cancel", size=13, color=CAPTION, align="center")
    )
    return fr, kids


def build_16e_slide(ox, oy):
    fr = rb.make_frame("16e Confirm slide", ox, oy)
    fid = fr["id"]
    kids = []
    kids += send_header(ox, oy, fid)
    # summary card
    kids.append(rb.make_rect("sum", ox + 28, oy + 210, 334, 200, fid, fid, fill="#0D0D0D", stroke="#333333", rx=14))
    kids.append(
        rb.make_text("sumt", ox + 44, oy + 228, 300, 22, fid, fid, "2 recipients · 75,000 sats", size=14, weight="700")
    )
    kids.append(
        rb.make_text("sumf", ox + 44, oy + 252, 300, 16, fid, fid, "≈ EUR 36.54 · one Arkade tx", size=11, color=CAPTION)
    )
    kids.append(rb.make_text("l1", ox + 44, oy + 290, 200, 18, fid, fid, "Savings", size=12))
    kids.append(rb.make_text("a1", ox + 220, oy + 290, 120, 18, fid, fid, "25,000", size=12, align="right"))
    kids.append(rb.make_text("l2", ox + 44, oy + 318, 200, 18, fid, fid, ARK_A, size=12))
    kids.append(rb.make_text("a2", ox + 220, oy + 318, 120, 18, fid, fid, "50,000", size=12, align="right"))
    kids.append(
        rb.make_text("foot", ox + 44, oy + 360, 300, 32, fid, fid, "Biometrics / PIN once for the batch.", size=11, color=HINT)
    )

    kids.append(rb.make_rect("scrim2", ox, oy + 440, PHONE_W, 404, fid, fid, fill="#000000", stroke=None, rx=0))
    kids[-1]["opacity"] = 0.35
    kids += rb.elastic_slider(ox + 28, oy + 560, fid, fid, progress=0.78, label_color="#1A1A1A")
    kids.append(
        rb.make_text(
            "hint",
            ox + 28,
            oy + 630,
            334,
            18,
            fid,
            fid,
            "release to send all",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    return fr, kids


def build_16f_success(ox, oy):
    fr = rb.make_frame("16f Success", ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(rb.make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SENT", size=20, weight="700", align="center"))
    kids.append(
        rb.make_text("amt", ox + 40, oy + 150, 310, 36, fid, fid, "75,000 sats", size=28, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "sub",
            ox + 40,
            oy + 192,
            310,
            20,
            fid,
            fid,
            "to 2 addresses · one tx",
            size=13,
            color=CAPTION,
            align="center",
        )
    )

    kids += rb.value_row(ox + 28, oy + 240, 334, "1 · Savings", f"{ARK_B} · 25,000", fid, fid, prefix="r0")
    kids += rb.value_row(ox + 28, oy + 316, 334, "2 · Paste", f"{ARK_A} · 50,000", fid, fid, prefix="r1")
    kids += rb.value_row(
        ox + 28,
        oy + 392,
        334,
        "Txid",
        rb.mid_ellipsis("a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcd", 10, 8),
        fid,
        fid,
        prefix="tx",
    )

    kids.append(rb.make_rect("det", ox + 28, oy + 500, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text(
            "detl",
            ox + 28,
            oy + 514,
            334,
            24,
            fid,
            fid,
            "View details",
            size=15,
            color="#000000",
            weight="700",
            align="center",
        )
    )
    kids.append(rb.make_rect("done", ox + 28, oy + 564, 334, 48, fid, fid, rx=10))
    kids.append(rb.make_text("donel", ox + 28, oy + 578, 334, 24, fid, fid, "Done", size=14, color=CAPTION, align="center"))
    return fr, kids


def build_16g_dust(ox, oy):
    fr = rb.make_frame("16g Dust bump", ox, oy)
    fid = fr["id"]
    kids = []
    kids += send_header(ox, oy, fid)
    c, _ = recipient_card(
        ox, oy, fid, "r0", oy + 210, label="My wallet · Savings", address=ARK_B, amount="25,000 sats"
    )
    kids += c
    c, _ = recipient_card(ox, oy, fid, "r1", oy + 298, label=None, address=ARK_A, amount="50,000 sats")
    kids += c
    kids += total_bar(ox, oy, fid, oy + 400, "75,000 sats")

    # alert dialog
    kids.append(rb.make_rect("scrim", ox, oy, PHONE_W, PHONE_H, fid, fid, fill="#000000", stroke=None, rx=28))
    kids[-1]["opacity"] = 0.6
    kids.append(rb.make_rect("dlg", ox + 36, oy + 260, 318, 280, fid, fid, fill="#111111", stroke="#FFFFFF", sw=1.5, rx=14))
    kids.append(
        rb.make_text("dt", ox + 56, oy + 280, 278, 24, fid, fid, "Adjust amount?", size=16, weight="700", align="center")
    )
    kids.append(
        rb.make_text(
            "db",
            ox + 56,
            oy + 318,
            278,
            90,
            fid,
            fid,
            "Sending 75,000 sats would leave change below the network minimum (330 sats).\n\nBump last recipient 50,000 → 50,412?",
            size=12,
            color=CAPTION,
            align="center",
        )
    )
    kids.append(rb.make_rect("ok", ox + 56, oy + 430, 278, 44, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
    kids.append(
        rb.make_text("okl", ox + 56, oy + 442, 278, 22, fid, fid, "Bump last recipient", size=13, color="#000000", weight="700", align="center")
    )
    kids.append(
        rb.make_text("no", ox + 56, oy + 488, 278, 20, fid, fid, "Cancel", size=13, color=CAPTION, align="center")
    )
    return fr, kids


BUILDERS = [
    ("16 Multisend empty", build_16_empty),
    ("16b Two recipients", build_16b_two),
    ("16c Three recipients", build_16c_three),
    ("16d Add recipient sheet", build_16d_sheet),
    ("16e Confirm slide", build_16e_slide),
    ("16f Success", build_16f_success),
    ("16g Dust bump", build_16g_dust),
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
        print(f"  build {name} @ ({ox},{oy}) kids={len(kids)}")

    changes = []
    for name, _ in reversed(BUILDERS):
        fr, kids = boards[name]
        finish(changes, fr, kids, page_id)

    for i, (name, _) in enumerate(BUILDERS):
        ox, oy = layout_pos(i)
        title, body = SCENE_NOTES[name]
        note_h = note_height(body)
        note_y = oy - note_h - 24
        note_changes, _ = make_note(page_id, title, body, ox, note_y)
        changes.extend(note_changes)

    print(f"pushing {len(changes)} changes")
    revn, vern = push(c, revn, vern, changes, chunk=40)
    team = re.search(r"PENPOT_TEAM_ID=(.*)", ENV).group(1).strip()
    url = f"{BASE}/#/workspace/{team}/{FILE}?page-id={page_id}"
    print(f"done revn={revn} vern={vern}")
    print(f"page={PAGE_NAME} id={page_id}")
    print(f"url={url}")


if __name__ == "__main__":
    main()
