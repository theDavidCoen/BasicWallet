#!/usr/bin/env python3
"""Add Figma yellow scene annotations (+ review catalog) to Penpot Basic Wallet UI."""
from __future__ import annotations

import json
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
PAGE = "0d808482-264d-8195-8008-a46d9fbf8811"
ROOT = "00000000-0000-0000-0000-000000000000"
BASE = "http://192.168.1.104:9001"
ENV = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
EMAIL = re.search(r"PENPOT_EMAIL=(.*)", ENV).group(1).strip()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", ENV).group(1).strip()

# Yellow annotation cards from the Figma draft (updated where review comments changed the screen).
# Keys match Penpot frame names when a board exists.
SCENE_NOTES: list[dict] = [
    {
        "board": "01 Home",
        "title": "01 Home",
        "body": (
            "Source of truth for the visual system. Exact match to the Basic mock: "
            "outlined tilted Bitcoin-B logo, centered sats balance, ghost Receive/Send, "
            "swap affordance between them.\n\n"
            "Balance aggregates Arkade wallet + optional LND liquidity (when a node is linked). "
            "Tap balance → privacy hide (see 01b). No FX rate footer. "
            "Swap opens BTC→USDT (and later Arkade↔Lightning rebalance)."
        ),
    },
    {
        "board": "01b Home privacy",
        "title": "01b Home — privacy",
        "body": (
            "Review comment #2: tap balance to hide amounts.\n\n"
            "Hidden state shows masked sats + “tap to show”. Same layout as Home otherwise "
            "(logo, Receive/Send/swap). No FX footer."
        ),
    },
    {
        "board": "02 Receive BIP21",
        "title": "02 Receive",
        "body": (
            "Review #3: BIP21 as primary (Arkade-style). Copy opens address-options modal "
            "(BIP21 URL, native segwit, Taproot, Ark, Lightning invoice).\n\n"
            "Arkade SDK generates fresh on-chain/Ark address. If LND is linked, Lightning "
            "invoice is an option in the modal. Logo present. No FX footer."
        ),
    },
    {
        "board": "03 Send empty",
        "title": "03 Send — empty",
        "body": (
            "From Home, balance animates to the top (shared element). Same balance size as Home (#4).\n\n"
            "• amount: manual entry (sats) + fiat rate line (#13)\n"
            "• to: address / npub / contact — paste only inside field\n"
            "• Choose Recipient opens private contacts\n"
            "• slide to confirm is INVISIBLE until amount + recipient are set\n"
            "• scan QR = large bottom-center affordance (not inside to)\n"
            "No < home back (#7). No FX footer."
        ),
    },
    {
        "board": "03b Send ready",
        "title": "03b Send — ready",
        "body": (
            "All fields filled → slide to confirm appears (#8–10).\n\n"
            "Fee estimate shows only when ready. QR scan hidden while slide is visible (#9). "
            "Slide fill grows white while dragging (#10). "
            "Hardware wallet: slide hands off to device signing if paired."
        ),
    },
    {
        "board": "04 Swap BTC to USDT",
        "title": "04 Swap",
        "body": (
            "Review #11: example flow is BTC → USDT (not Arkade↔LND as the primary mock).\n\n"
            "Internal / in-app swap UX. Quote shows fee. Later: Arkade ↔ Lightning rebalance "
            "when a node is linked (see 06). No FX footer on this screen."
        ),
    },
    {
        "board": "06 Connect Node",
        "title": "06 Connect Node",
        "body": (
            "Goal: surface LND funds alongside Arkade wallet on Home.\n\n"
            "BTCPay = guided UX. NWC = Nostr-native pairing. Manual LND for operators.\n\n"
            "Review #21: in-app only send/receive funds via LND — no channel management."
        ),
    },
    # Screens annotated in Figma but not yet drawn as Penpot boards
    {
        "board": None,
        "title": "05 Settings",
        "body": (
            "Central hub for power-user features.\n\n"
            "• Node: LND via BTCPay link or NWC\n"
            "• Hardware: Trezor & others\n"
            "• Nostr: local nsec behind OS passkey; npub shown\n"
            "• Contacts: private encrypted directory\n"
            "• Multisig: Nostr-coordinated P2WSH\n"
            "• Backup: default OS passkey/cloud — never shows seed in onboarding"
        ),
    },
    {
        "board": None,
        "title": "07 Hardware Wallet",
        "body": (
            "Optional signing path for Arkade-managed or watch-only Bitcoin wallets.\n\n"
            "On send/multisig, if a hardware device is paired, the confirm slider routes to "
            "device approval instead of software signing. Seeds from HW are never imported "
            "into Basic."
        ),
    },
    {
        "board": None,
        "title": "08 Contacts",
        "body": (
            "Private recipient directory (Bitcoin-only initially): name + identifiers "
            "(address, npub, NIP-05).\n\n"
            "Used by Send → Choose Recipient and Nostr payment requests. No OS contact "
            "permission. Encrypted with wallet account data (Arkade-backed)."
        ),
    },
    {
        "board": None,
        "title": "09 Nostr Payment Request",
        "body": (
            "Async encrypted payment requests over Nostr (Bitcoin only — no multi-chain in Basic v1).\n\n"
            "Flow: choose contact → amount/memo → gift-wrapped request → recipient accepts "
            "& returns fresh address → sender confirms on Send slide.\n\n"
            "States: pending / accepted / rejected / expired / cancelled."
        ),
    },
    {
        "board": None,
        "title": "10 Multisig",
        "body": (
            "Native Bitcoin P2WSH multisig coordinated over Nostr DMs (NIP-17 gift wraps). "
            "Invite cosigners by npub/NIP-05 — no coordinator server.\n\n"
            "Policy: from-scratch creation uses in-app keys only (no weak foreign xpubs). "
            "Import descriptor/BSMS allowed for recovery."
        ),
    },
    {
        "board": None,
        "title": "11 Onboarding — Create",
        "body": (
            "CRITICAL PRODUCT RULE: never expose seed phrases in the initial wallet configuration.\n\n"
            "Default path = OS passkey + vendor cloud backup (iCloud Keychain / Google Password Manager). "
            "Wallet created via Arkade Docs SDK.\n\n"
            "Advanced users can opt into encrypted Nostr-relay backup or home-server backup."
        ),
    },
    {
        "board": None,
        "title": "12 Advanced Backup",
        "body": (
            "Alternatives to OS cloud backup:\n\n"
            "1) Encrypted backup over Nostr — user may add relays beyond defaults.\n"
            "2) Encrypted backup to a domestic / self-hosted server.\n\n"
            "Both are opt-in. Default onboarding never shows seed words."
        ),
    },
    {
        "board": None,
        "title": "13 Node Status",
        "body": (
            "Post-connect dashboard for LND. Feeds Home balance split and Swap from/to Lightning.\n\n"
            "Disconnect clears macaroon/NWC secrets from device secure storage. "
            "Channel funds remain on the node (no in-app channel management)."
        ),
    },
]

REVIEW_CATALOG = (
    "David review comments (applied to boards):\n\n"
    "1 Logo: hollow tilted ₿ as B (vector)\n"
    "2 Home privacy: tap balance to hide\n"
    "3 Receive BIP21 + copy → address options modal\n"
    "4 Send balance same size as Home\n"
    "5 Screen titles white, consistent size\n"
    "6 Logo on screens that were missing it\n"
    "7 Remove “< home” (system back only)\n"
    "8–9 Better QR scan; hide QR when slide visible\n"
    "10 Slide: white fill grows while dragging\n"
    "11 Swap example BTC → USDT\n"
    "12–19 Remove FX rate footer where marked\n"
    "13 Amount also shows fiat rate\n"
    "20 Graphic fix as indicated\n"
    "21 Node: send/receive only, no channel management"
)


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


def make_text(name, x, y, w, h, parent, frame, text, *, size=12, color="#1A1A1A", weight="400"):
    paragraphs = []
    for block in text.split("\n"):
        paragraphs.append(
            {
                "type": "paragraph",
                "text-align": "left",
                "children": [
                    {
                        "line-height": "1.35",
                        "font-style": "normal",
                        "text-align": "left",
                        "font-size": str(size),
                        "font-weight": str(weight),
                        "font-family": "JetBrains Mono",
                        "font-id": "gfont-jetbrains-mono",
                        "font-variant": "normal",
                        "text-decoration": "none",
                        "text-transform": "none",
                        "fills": [{"fill-color": color, "fill-opacity": 1}],
                        "text": block if block else " ",
                    }
                ],
            }
        )
    o = {
        "id": uid(),
        "name": name,
        "type": "text",
        "parent-id": parent,
        "frame-id": frame,
        "fills": [],
        "strokes": [],
        "grow-type": "fixed",
        "content": {
            "type": "root",
            "vertical-align": "top",
            "children": [{"type": "paragraph-set", "children": paragraphs}],
        },
    }
    return geom(o, x, y, w, h)


def make_rect(name, x, y, w, h, parent, frame, fill):
    o = {
        "id": uid(),
        "name": name,
        "type": "rect",
        "parent-id": parent,
        "frame-id": frame,
        "fills": [{"fill-color": fill, "fill-opacity": 1}],
        "strokes": [],
        "r1": 8,
        "r2": 8,
        "r3": 8,
        "r4": 8,
    }
    return geom(o, x, y, w, h)


def make_note_frame(title: str, body: str, x: float, y: float, w: float = 300, h: float = 220):
    """Yellow sticky as its own frame (editable), like Figma Annotation component."""
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
    }
    geom(frame, x, y, w, h)

    title_o = make_text("note-title", x + 14, y + 12, w - 28, 22, fid, fid, title, size=13, weight="700")
    body_o = make_text("note-body", x + 14, y + 40, w - 28, h - 54, fid, fid, body, size=11, weight="400")
    frame["shapes"] = [title_o["id"], body_o["id"]]
    return frame, [title_o, body_o]


def add_obj(changes, obj, parent=ROOT, frame=None):
    changes.append(
        {
            "type": "add-obj",
            "id": obj["id"],
            "page-id": PAGE,
            "frame-id": frame or obj.get("frame-id") or ROOT,
            "parent-id": parent,
            "obj": obj,
        }
    )


def main():
    c = Client()
    c.login()
    objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    frames = {
        o["name"]: o
        for o in objs.values()
        if o.get("type") == "frame" and o.get("name") not in ("Root Frame",)
    }

    # Remove previous annotation notes if re-run
    to_del = [
        oid
        for oid, o in objs.items()
        if (o.get("name") or "").startswith("note ·")
        or (o.get("name") or "") in ("note-title", "note-body", "Review comments catalog")
    ]
    meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    if to_del:
        # delete children first? del-obj should cascade for frames
        st, out = c.post_json(
            "/api/rpc/command/update-file",
            {
                "id": FILE,
                "session-id": uid(),
                "revn": revn,
                "vern": vern,
                "changes": [{"type": "del-obj", "id": i, "page-id": PAGE} for i in to_del],
            },
        )
        print("deleted old notes", len(to_del), st)
        meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
        frames = {
            o["name"]: o
            for o in objs.values()
            if o.get("type") == "frame" and o.get("name") not in ("Root Frame",)
        }

    changes = []
    # Notes above existing boards
    for note in SCENE_NOTES:
        board = note["board"]
        if board and board in frames:
            f = frames[board]
            # estimate height from body length
            lines = 4 + note["body"].count("\n") + len(note["body"]) // 42
            h = min(320, max(160, 36 + lines * 15))
            x = f["x"]
            y = f["y"] - h - 24
            frame, children = make_note_frame(note["title"], note["body"], x, y, w=min(390, 320), h=h)
            add_obj(changes, frame, ROOT, frame["id"])
            for ch in children:
                add_obj(changes, ch, frame["id"], frame["id"])
            print("note above", board, "at", x, y)
        elif board:
            print("WARN missing board", board)

    # Future-screen notes in a row below boards
    future = [n for n in SCENE_NOTES if n["board"] is None]
    base_y = 80 + 844 + 80  # below phone boards
    for i, note in enumerate(future):
        col = i % 4
        row = i // 4
        x = col * 340
        y = base_y + row * 280
        lines = 4 + note["body"].count("\n") + len(note["body"]) // 42
        h = min(260, max(180, 36 + lines * 14))
        frame, children = make_note_frame(note["title"], note["body"], x, y, w=320, h=h)
        add_obj(changes, frame, ROOT, frame["id"])
        for ch in children:
            add_obj(changes, ch, frame["id"], frame["id"])
        print("future note", note["title"], "at", x, y)

    # Review catalog sticky
    rx, ry = 1360, base_y
    frame, children = make_note_frame("Review comments catalog", REVIEW_CATALOG, rx, ry, w=360, h=340)
    # rename frame
    frame["name"] = "Review comments catalog"
    add_obj(changes, frame, ROOT, frame["id"])
    for ch in children:
        add_obj(changes, ch, frame["id"], frame["id"])

    st, out = c.post_json(
        "/api/rpc/command/update-file",
        {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
    )
    print("add status", st, "changes", len(changes), "revn", out.get("revn"))
    if st != 200:
        print(out)
        raise SystemExit(1)
    print("OK")


if __name__ == "__main__":
    main()
