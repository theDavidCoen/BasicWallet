#!/usr/bin/env python3
"""Split Basic Wallet boards across Penpot pages + restore yellow scene notes."""
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

# Import builders from clean rebuild
_spec = importlib.util.spec_from_file_location(
    "rebuild", Path(__file__).with_name("penpot_rebuild_clean.py")
)
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

PAGES = [
    ("00 Onboarding", [
        "11 Onboarding Create",
        "12 Advanced Backup",
        "12d Nostr backup",
        "12e Home server backup",
        "12b Restore seed",
        "12c Restore nsec",
    ]),
    ("01 Home", ["01 Home", "01b Home privacy", "01c Wallet switcher", "01d Activity sheet"]),
    ("02 Receive", ["02 Receive BIP21", "02b Receive sheet", "02c Receive share sheet"]),
    ("03 Send", ["03 Send empty", "03b Send ready", "03c Send slide early"]),
    ("04 Swap", ["04 Swap BTC to USDT"]),
    ("05 Node", ["06 Connect Node", "13 Node Status"]),
    ("06 Settings", ["05 Settings", "05b Display currencies", "07 Hardware Wallet"]),
    ("07 Contacts", ["08 Contacts", "08d Contacts search", "08b Choose Recipient", "08c Edit contact"]),
    ("08 Nostr", ["09 Nostr Payment Request"]),
    ("09 Multisig", ["10 Multisig", "10b Multisig invite", "10c Multisig pending", "10d Multisig cosign"]),
]

# Yellow annotation cards (from Figma / penpot_add_comments), keyed by board name.
SCENE_NOTES: dict[str, tuple[str, str]] = {
    "01 Home": (
        "01 Home",
        "Source of truth for the visual system. Exact match to the Basic mock: "
        "outlined tilted Bitcoin-B logo, centered sats balance, ghost Receive/Send, "
        "swap affordance between them.\n\n"
        "Balance aggregates Arkade wallet + optional LND liquidity (when a node is linked). "
        "Tap balance → privacy hide (see 01b). "
        "Swap opens BTC→USDT (and later Arkade↔Lightning rebalance).\n\n"
        "Avatar (upper left) opens wallet switcher. Swipe up → activity sheet.",
    ),
    "01b Home privacy": (
        "01b Home — privacy",
        "Tap balance to hide amounts.\n\n"
        "Hidden state shows masked sats + “tap to show”. Same layout as Home otherwise "
        "(logo, Receive/Send/swap, rates).",
    ),
    "01c Wallet switcher": (
        "01c Wallet switcher",
        "Modal over Home. Switch between wallets / create new.\n\n"
        "Triggered from the avatar chip. Does not leave the Home context.",
    ),
    "01d Activity sheet": (
        "01d Activity",
        "Swipe-up sheet from Home: recent receives, sends, swaps.\n\n"
        "Keep it glanceable — not a full block explorer.",
    ),
    "02 Receive BIP21": (
        "02 Receive",
        "BIP21 as primary (Arkade-style). Copy / Share icons (not text buttons).\n\n"
        "Address-options modal: BIP21 URL, native segwit, Taproot, Ark, Lightning invoice.\n\n"
        "Example QR on canvas for visual density.",
    ),
    "02b Receive sheet": (
        "02b Receive — format sheet",
        "Bottom sheet: pick address format before showing QR / BIP21 string.",
    ),
    "02c Receive share sheet": (
        "02c Receive — share",
        "Share copy must start with:\n"
        "“This is my address:” + BIP21 URL.\n\n"
        "Primary action: Share BIP21 URL.",
    ),
    "03 Send empty": (
        "03 Send — empty",
        "From Home, balance sits under SEND title.\n\n"
        "• amount + to fields empty\n"
        "• Choose Recipient → contacts\n"
        "• slide to confirm HIDDEN until ready\n"
        "• camera/QR scan = large bottom-center affordance\n"
        "No in-app back chevron (system back only).",
    ),
    "03b Send ready": (
        "03b Send — ready (mid/late drag)",
        "Fields filled → slide to confirm appears.\n\n"
        "White elastic covers most of the label → label turns BLACK.\n"
        "Fee estimate only when ready. Hardware: slide can hand off to device signing.",
    ),
    "03c Send slide early": (
        "03c Send — early drag",
        "Same ready state, early drag progress.\n\n"
        "Elastic has not covered the label yet → label stays WHITE.\n"
        "Documents the color flip vs 03b.",
    ),
    "04 Swap BTC to USDT": (
        "04 Swap",
        "Example flow: BTC → USDT (in-app).\n\n"
        "Quote + fee. Slide to confirm. Later: Arkade ↔ Lightning rebalance when a node is linked.",
    ),
    "06 Connect Node": (
        "06 Connect Node",
        "Surface LND funds alongside Arkade on Home.\n\n"
        "BTCPay = guided. NWC = Nostr-native. Manual LND for operators.\n\n"
        "In-app: send/receive only — no channel management.",
    ),
    "13 Node Status": (
        "13 Node Status",
        "Post-connect dashboard for LND. Feeds Home balance split.\n\n"
        "Disconnect clears secrets from secure storage. Channel funds stay on the node.",
    ),
    "05 Settings": (
        "05 Settings",
        "Hub for power-user features:\n"
        "• Display currencies\n"
        "• Privacy / node / hardware\n"
        "• Contacts · Multisig · Advanced backup",
    ),
    "05b Display currencies": (
        "05b Display currencies",
        "Toggle which fiat tickers appear under the sats balance (USD/EUR/…).",
    ),
    "07 Hardware Wallet": (
        "07 Hardware Wallet",
        "Optional signing path. On send/multisig, if paired, confirm slider routes to "
        "device approval. Seeds from HW are never imported into Basic.",
    ),
    "08 Contacts": (
        "08 Contacts · list",
        "Private directory: initial avatar, type pill (npub/bc1/lnurl/NIP-05),\n"
        "mid-ellipsis id, chevron. Search field. + Add CTA.\n"
        "No OS contacts permission.",
    ),
    "08d Contacts search": (
        "08d Contacts — search",
        "Live filter as typed; match count; same row chrome as list.",
    ),
    "08b Choose Recipient": (
        "08b Choose Recipient",
        "Paste address/npub is primary (white CTA), then contact list.\n"
        "Opened from Send.",
    ),
    "08c Edit contact": (
        "08c Edit contact",
        "Avatar · name · type chips · identifier · Save / Delete.",
    ),
    "09 Nostr Payment Request": (
        "09 Nostr Payment Request",
        "Async encrypted payment requests over Nostr (Bitcoin only).\n\n"
        "Contact → amount/memo → gift-wrapped request → recipient returns address → Send slide.\n"
        "States: pending / accepted / rejected / expired / cancelled.",
    ),
    "10 Multisig": (
        "10 Multisig",
        "Native Bitcoin P2WSH multisig coordinated over Nostr DMs (NIP-17).\n\n"
        "Invite cosigners by npub/NIP-05 — no coordinator server. "
        "From-scratch policy uses in-app keys only.",
    ),
    "10b Multisig invite": (
        "10b Multisig — invite",
        "Share invite code / link with a cosigner over Nostr or out-of-band.",
    ),
    "10c Multisig pending": (
        "10c Multisig — pending",
        "Per-cosigner signature status for an open proposal.",
    ),
    "10d Multisig cosign": (
        "10d Multisig — cosign",
        "Review proposal details, then slide to cosign (or HW handoff if paired).",
    ),
    "11 Onboarding Create": (
        "11 Onboarding — Create",
        "CRITICAL: never expose seed phrases in initial wallet setup.\n\n"
        "Default = OS passkey + vendor cloud backup. "
        "Advanced path → Advanced Backup. Footer: «Seed phrase or nsec? Restore here.»",
    ),
    "12 Advanced Backup": (
        "12 Advanced Backup",
        "Tap card → detail:\n"
        "Nostr relays → 12d\n"
        "Home server → 12e\n"
        "Hide complexity: few fields only.",
    ),
    "12d Nostr backup": (
        "12d Nostr backup",
        "Default relays ON, + Add relay,\nEnable encrypted backup. No seed.",
    ),
    "12e Home server backup": (
        "12e Home server",
        "URL + optional token, Test connection,\nEnable. Ciphertext only on server.",
    ),
    "12b Restore seed": (
        "12b Restore · seed",
        "BIP39 + optional passphrase. Segment: Seed | nsec.",
    ),
    "12c Restore nsec": (
        "12c Restore · nsec",
        "Import nsec restores wallet + Nostr identity\n"
        "when the user used encrypted Nostr backup.",
    ),
}

# Review pins → (page board name, rel x, rel y)
PIN_MAP = {
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

COL = 460
ORIGIN_X = 40
BOARD_Y = 320  # room for yellow notes above
NOTE_Y = 40
NOTE_W = 390


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


def note_height(body: str) -> int:
    lines = 0
    for block in body.split("\n"):
        lines += max(1, (len(block) // 42) + 1)
    return max(160, min(360, 54 + lines * 16))


def make_note(page_id: str, title: str, body: str, x: float, y: float):
    h = note_height(body)
    # reuse rebuild helpers but with yellow frame
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
    title_o = rb.make_text("note-title", x + 14, y + 12, NOTE_W - 28, 22, fid, fid, title, size=13, color="#1A1A1A", weight="700")
    # body as multi-paragraph via content
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
    changes.append({"type": "add-obj", "id": frame["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame})
    for o in (title_o, body_o):
        changes.append({"type": "add-obj", "id": o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": o})
    return changes, h


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    existing_pages = list(meta["data"]["pages"])
    page_index = meta["data"]["pagesIndex"]

    # 1) Ensure we have exactly the pages we want (reuse first page id)
    first_id = existing_pages[0]
    wanted_names = [n for n, _ in PAGES]
    page_ids = {wanted_names[0]: first_id}

    changes = [{"type": "mod-page", "id": first_id, "name": wanted_names[0]}]

    # delete extra pages (not first)
    for pid in existing_pages[1:]:
        changes.append({"type": "del-page", "id": pid})
        print("del page", page_index[pid]["name"])

    # create remaining pages
    for name in wanted_names[1:]:
        pid = uid()
        page_ids[name] = pid
        changes.append({"type": "add-page", "id": pid, "name": name})
        print("add page", name, pid)

    revn, vern = push(c, revn, vern, changes, chunk=20)
    print("pages ready, revn", revn)

    # 2) Wipe objects on every page
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    wipe = []
    for pid in meta["data"]["pages"]:
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={pid}")["objects"]
        for oid, o in objs.items():
            if oid == ROOT or o.get("name") == "Root Frame":
                continue
            wipe.append({"type": "del-obj", "id": oid, "page-id": pid})
    print(f"wiping {len(wipe)} objects…")
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    # 3) Rebuild boards + notes per page
    frame_pos = {}  # name -> (page_id, x, y, frame_id)
    for page_name, board_names in PAGES:
        page_id = page_ids[page_name]
        changes = []
        for col_i, bname in enumerate(board_names):
            bx = ORIGIN_X + col_i * COL
            # note above
            if bname in SCENE_NOTES:
                title, body = SCENE_NOTES[bname]
                note_changes, _nh = make_note(page_id, title, body, bx, NOTE_Y)
                changes.extend(note_changes)
            # board
            fr, kids = rb.BUILDERS[bname](bx, BOARD_Y)
            fr["shapes"] = [k["id"] for k in kids]
            changes.append(
                {"type": "add-obj", "id": fr["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": fr}
            )
            for k in kids:
                changes.append(
                    {
                        "type": "add-obj",
                        "id": k["id"],
                        "page-id": page_id,
                        "frame-id": fr["id"],
                        "parent-id": fr["id"],
                        "obj": k,
                    }
                )
            frame_pos[bname] = (page_id, bx, BOARD_Y, fr["id"])
            print(f"  {page_name}: {bname} @ ({bx},{BOARD_Y})")
        print(f"pushing {page_name} ({len(changes)} objs)…")
        revn, vern = push(c, revn, vern, changes, chunk=40)

    # 4) Reposition review comment pins
    threads = {t["seqn"]: t for t in c.get(f"/api/rpc/command/get-comment-threads?file-id={FILE}")}
    for seqn, (bname, rx, ry) in PIN_MAP.items():
        t = threads.get(seqn)
        info = frame_pos.get(bname)
        if not t or not info:
            continue
        _pid, bx, by, fid = info
        pos = {"x": bx + rx, "y": by + ry}
        st, _ = c.post(
            "/api/rpc/command/update-comment-thread-position",
            {"id": t["id"], "position": pos, "frame-id": fid},
        )
        print(f"  pin #{seqn} -> {bname} ({st})")

    # Summary
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    print("\n=== PAGES ===")
    for pid in meta["data"]["pages"]:
        name = meta["data"]["pagesIndex"][pid]["name"]
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={pid}")["objects"]
        frames = [o["name"] for o in objs.values() if o.get("type") == "frame" and not o["name"].startswith("note")]
        notes = sum(1 for o in objs.values() if (o.get("name") or "").startswith("note ·"))
        print(f"  {name}: boards={frames} notes={notes}")
    print("DONE")


if __name__ == "__main__":
    main()
