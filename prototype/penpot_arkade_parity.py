#!/usr/bin/env python3
"""DEPRECATED — Arkade option parity was removed to hide complexity (2026-09-15).

Do not re-run. Use penpot_hide_arkade.py / penpot_apply_round3 Settings instead.
Original: every Arkade wallet Settings option + Apps + Notes from options.tsx.
"""
from __future__ import annotations

raise SystemExit(
    "penpot_arkade_parity.py is deprecated. Arkade options were removed from the UI. "
    "See penpot_hide_arkade.py."
)

# --- archived below (unreachable) ---
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

spec = importlib.util.spec_from_file_location("rb", Path(__file__).with_name("penpot_rebuild_clean.py"))
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

PHONE_W, PHONE_H = 390, 844
COL, ROW = 460, 980
ORIGIN_X, BOARD_Y = 40, 80

# Pages to create/update
NEW_PAGES = [
    (
        "06 Settings",
        [
            # row0: hub matching Arkade Menu
            ["05 Settings"],
            # row1 General
            [
                "S-Currency",
                "S-Display",
                "S-Notifications",
                "S-Notes",
            ],
            # row2 General cont + Security
            [
                "S-About",
                "S-Support",
                "S-Advanced",
                "S-Backup",
            ],
            # row3 Security + Display children
            [
                "S-Lock",
                "S-Reset",
                "S-Bitcoin unit",
                "S-Haptics",
            ],
            # row4 Display + Advanced children
            [
                "S-Theme",
                "S-Password",
                "S-Coin control",
                "S-Contracts",
            ],
            # row5 Advanced rest
            [
                "S-Delegates",
                "S-Logs",
                "S-Server",
                "S-Solvers",
            ],
            # row6 Basic-only extras (keep product)
            [
                "05b Display currencies",
                "05c Privacy",
                "05d Nostr identity",
                "07 Hardware Wallet",
            ],
        ],
    ),
    (
        "10 Apps",
        [
            ["A-DFX", "A-Arkade Mint", "A-Lendasat", "A-Satora"],
            ["A-Mint Asset", "A-Import asset", "A-Asset detail", "A-Assets settings"],
            ["A-Reissue", "A-Burn"],
        ],
    ),
    (
        "11 Notes",
        [
            ["N-Notes form", "N-Redeem", "N-Success"],
        ],
    ),
    (
        "12 Detail",
        [
            ["D-Unlock", "D-Transaction", "D-Bitcoin detail", "D-Scan"],
        ],
    ),
]


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


def push(c, revn, vern, changes, chunk=40):
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


def finish(changes, page_id, fr, kids):
    fr["shapes"] = [k["id"] for k in kids]
    add(changes, page_id, fr, ROOT, ROOT)
    for k in kids:
        add(changes, page_id, k, fr["id"], fr["id"])


def chrome(ox, oy, title):
    fr = rb.make_frame(title if not title.startswith(("S-", "A-", "N-", "D-")) else title, ox, oy)
    # rename frame to exact name passed
    fr["name"] = title
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 40, fid, fid, 0.7)
    kids.append(rb.make_text("title", ox + 40, oy + 95, 310, 28, fid, fid, title.split("-", 1)[-1].upper() if title[:2] in ("S-", "A-", "N-", "D-") else title.upper(), size=18, weight="700", align="center"))
    return fr, fid, kids


def list_screen(ox, oy, name, header, rows, *, section_labels=None):
    """Generic Arkade-style settings list."""
    fr = rb.make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 40, fid, fid, 0.7)
    kids.append(rb.make_text("title", ox + 40, oy + 95, 310, 28, fid, fid, header, size=20, weight="700", align="center"))
    y = oy + 150
    if section_labels:
        # section_labels: list of (label|None, count). None skips the section header.
        idx = 0
        for lab, count in section_labels:
            if lab:
                kids.append(rb.make_text(f"sec-{lab}", ox + 28, y, 334, 20, fid, fid, lab, size=12, color="#8C8C8C"))
                y += 28
            for _ in range(count):
                if idx >= len(rows):
                    break
                label, sub = rows[idx]
                color = "#E07070" if label in ("Reset app", "Unilateral Exit") else "#FFFFFF"
                kids.append(rb.make_rect(f"r-{idx}", ox + 28, y, 334, 56, fid, fid))
                kids.append(rb.make_text(f"rl-{idx}", ox + 44, y + 10, 260, 20, fid, fid, label, size=14, weight="700", color=color))
                if sub:
                    kids.append(rb.make_text(f"rs-{idx}", ox + 44, y + 32, 260, 16, fid, fid, sub, size=11, color="#8C8C8C"))
                kids.append(rb.make_text(f"ch-{idx}", ox + 320, y + 16, 30, 22, fid, fid, "›", size=18, color=color if color == "#E07070" else "#8C8C8C", align="right"))
                y += 64
                idx += 1
            y += 12
    else:
        for i, (label, sub) in enumerate(rows):
            kids.append(rb.make_rect(f"r-{i}", ox + 28, y, 334, 56, fid, fid))
            kids.append(rb.make_text(f"rl-{i}", ox + 44, y + 10, 260, 20, fid, fid, label, size=14, weight="700"))
            if sub:
                kids.append(rb.make_text(f"rs-{i}", ox + 44, y + 32, 260, 16, fid, fid, sub, size=11, color="#8C8C8C"))
            kids.append(rb.make_text(f"ch-{i}", ox + 320, y + 16, 30, 22, fid, fid, "›", size=18, color="#8C8C8C", align="right"))
            y += 64
    need_h = int(y - oy + 40)
    if need_h > rb.PHONE_H:
        fr["height"] = need_h
    return fr, kids


def build_settings_hub(ox, oy):
    return list_screen(
        ox,
        oy,
        "05 Settings",
        "SETTINGS",
        [
            ("Display currencies", "USD / EUR under sats"),
            ("Privacy", "Biometrics · App PIN · screenshots"),
            ("Nostr identity", "npub / nsec"),
            ("Contacts", "Private directory"),
            ("Duress PIN", "Decoy unlock"),
            ("Connected node", "ASP / Lightning status"),
            ("Hardware wallet", "Ledger / Trezor"),
            ("Multisig", "P2WSH"),
            ("Backup", "Passkey · Nostr · home server"),
            ("Restore", "Seed · nsec · server"),
            ("Arkade", "Delegates · exits"),
            ("Reset app", "Wipe this device"),
            ("About", "Version · ASP · GitHub"),
        ],
        section_labels=[
            (None, 1),
            ("Account", 4),
            ("Wallet Settings", 5),
            ("Provider Settings", 1),
            (None, 2),
        ],
    )


def build_arkade_settings_hub(ox, oy):
    return list_screen(
        ox,
        oy,
        "05as Arkade Settings",
        "ARKADE",
        [
            ("Delegates", "VTXO renew / custom URL"),
            ("Recovery address", "Onchain sweep destination"),
            ("Collaborative Exit", "Operator settle · offboard"),
            ("Unilateral Exit", "Package · execute without ASP"),
        ],
    )


def toggle_screen(ox, oy, name, header, toggles):
    fr = rb.make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 40, fid, fid, 0.7)
    kids.append(rb.make_text("title", ox + 40, oy + 95, 310, 28, fid, fid, header, size=20, weight="700", align="center"))
    for i, (label, sub, on) in enumerate(toggles):
        y = oy + 160 + i * 80
        kids.append(rb.make_rect(f"r-{i}", ox + 28, y, 334, 64, fid, fid))
        kids.append(rb.make_text(f"rl-{i}", ox + 44, y + 12, 220, 20, fid, fid, label, size=14, weight="700"))
        kids.append(rb.make_text(f"rs-{i}", ox + 44, y + 36, 220, 16, fid, fid, sub, size=11, color="#8C8C8C"))
        kids.append(rb.make_text(f"to-{i}", ox + 280, y + 22, 60, 22, fid, fid, "ON" if on else "OFF", size=13, color="#8C8C8C", align="right"))
    return fr, kids


def info_screen(ox, oy, name, header, lines, *, cta=None):
    fr = rb.make_frame(name, ox, oy)
    fid = fr["id"]
    kids = []
    kids += rb.logo(ox + 150, oy + 40, fid, fid, 0.7)
    kids.append(rb.make_text("title", ox + 40, oy + 95, 310, 28, fid, fid, header, size=20, weight="700", align="center"))
    y = oy + 160
    for i, line in enumerate(lines):
        kids.append(rb.make_text(f"l-{i}", ox + 28, y, 334, 40, fid, fid, line, size=13, color="#8C8C8C"))
        y += 48
    if cta:
        kids.append(rb.make_rect("cta", ox + 28, oy + 720, 334, 48, fid, fid, fill="#FFFFFF", stroke=None, rx=10))
        kids.append(rb.make_text("ctal", ox + 28, oy + 734, 334, 24, fid, fid, cta, size=15, color="#000000", weight="700", align="center"))
    return fr, kids


BUILDERS = {
    "05 Settings": build_settings_hub,
    "05as Arkade Settings": build_arkade_settings_hub,
    "S-Currency": lambda x, y: list_screen(x, y, "S-Currency", "CURRENCY", [("USD", "selected"), ("EUR", ""), ("GBP", ""), ("JPY", "")]),
    "S-Display": lambda x, y: list_screen(
        x, y, "S-Display", "DISPLAY", [("Bitcoin unit", "sats / BTC"), ("Haptic feedback", "ON"), ("Theme", "Dark")]
    ),
    "S-Notifications": lambda x, y: toggle_screen(
        x, y, "S-Notifications", "NOTIFICATIONS", [("Allow notifications", "Push alerts for payments", True)]
    ),
    "S-Notes": lambda x, y: info_screen(
        x,
        y,
        "S-Notes",
        "NOTES",
        ["Create or redeem Arkade notes", "(ecash-style offchain notes).", "Opens Notes form flow →"],
        cta="Open notes",
    ),
    "S-About": lambda x, y: info_screen(
        x, y, "S-About", "ABOUT", ["Arkade Wallet", "Version from build", "Open-source licenses"]
    ),
    "S-Support": lambda x, y: info_screen(
        x,
        y,
        "S-Support",
        "SUPPORT",
        [
            "Get help, report bugs, ask questions.",
            "Conversations are private.",
            "Past tickets stay available.",
        ],
        cta="Contact support",
    ),
    "S-Advanced": lambda x, y: list_screen(
        x,
        y,
        "S-Advanced",
        "ADVANCED",
        [
            ("Arkade Mint", "Assets app"),
            ("Change password", ""),
            ("Coin control", "Vtxos"),
            ("Contracts", "dev"),
            ("Delegates", "renewals"),
            ("Logs", ""),
            ("Server", "Asp / network"),
            ("Solvers", "Boltz / Lightning"),
        ],
    ),
    "S-Backup": lambda x, y: toggle_screen(
        x,
        y,
        "S-Backup",
        "BACKUP",
        [
            ("Show recovery phrase", "Sensitive · confirm first", False),
            ("Enable Nostr backups", "Encrypted relay backup", False),
        ],
    ),
    "S-Lock": lambda x, y: info_screen(
        x, y, "S-Lock", "LOCK", ["Lock wallet now.", "Unlock requires password.", "Can open Change password from here."], cta="Lock now"
    ),
    "S-Reset": lambda x, y: info_screen(
        x,
        y,
        "S-Reset",
        "RESET WALLET",
        ["☐ I have backed up my wallet", "This wipes keys from the device."],
        cta="Reset wallet",
    ),
    "S-Bitcoin unit": lambda x, y: list_screen(x, y, "S-Bitcoin unit", "BITCOIN UNIT", [("sats", "selected"), ("BTC", ""), ("bits", "")]),
    "S-Haptics": lambda x, y: toggle_screen(
        x, y, "S-Haptics", "HAPTICS", [("Haptic feedback", "Vibration on taps", True)]
    ),
    "S-Theme": lambda x, y: list_screen(x, y, "S-Theme", "THEME", [("Auto", ""), ("Dark", "selected"), ("Light", "")]),
    "S-Password": lambda x, y: info_screen(
        x,
        y,
        "S-Password",
        "CHANGE PASSWORD",
        ["Current password", "New password", "Confirm new password"],
        cta="Save",
    ),
    "S-Coin control": lambda x, y: info_screen(
        x,
        y,
        "S-Coin control",
        "COIN CONTROL",
        ["List VTXOs / coins", "Renew / select UTXOs", "Arkade: Settings → Advanced → Coin control"],
        cta="Renew coins",
    ),
    "S-Contracts": lambda x, y: info_screen(x, y, "S-Contracts", "CONTRACTS", ["Dev-mode covenant list", "Inspect active contracts"]),
    "S-Delegates": lambda x, y: toggle_screen(
        x,
        y,
        "S-Delegates",
        "DELEGATES",
        [("Use default Arkade delegate", "Manage renewals", True)],
    ),
    "S-Logs": lambda x, y: info_screen(
        x, y, "S-Logs", "LOGS", ["[12:01] wallet unlocked", "[12:02] sync ok", "[12:03] vtxo refresh"], cta="Clear"
    ),
    "S-Server": lambda x, y: info_screen(
        x,
        y,
        "S-Server",
        "SERVER",
        ["Server URL / Asp endpoint", "⚠ Wallet resets when server changes", "Backup first."],
        cta="Save server",
    ),
    "S-Solvers": lambda x, y: list_screen(
        x, y, "S-Solvers", "SOLVERS", [("Default solver", "Boltz"), ("+ Add solver", "Custom endpoint")]
    ),
    "05b Display currencies": lambda x, y: list_screen(
        x, y, "05b Display currencies", "CURRENCIES", [("USD", "ON"), ("EUR", "ON"), ("GBP", "OFF")]
    ),
    "05c Privacy": lambda x, y: toggle_screen(
        x, y, "05c Privacy", "PRIVACY", [("Biometrics lock", "", True), ("App PIN", "Not set", False), ("Block screenshots", "", True)]
    ),
    "05d Nostr identity": lambda x, y: info_screen(
        x, y, "05d Nostr identity", "NOSTR", ["npub1basic…", "NIP-05 not set", "nsec behind OS passkey"]
    ),
    "07 Hardware Wallet": rb.BUILDERS["07 Hardware Wallet"],
    # Apps
    "A-DFX": lambda x, y: info_screen(
        x, y, "A-DFX", "DFX", ["Buy or sell bitcoin", "Embedded DFX webview", "Home upsell → Do more with your money"], cta="Open DFX"
    ),
    "A-Arkade Mint": lambda x, y: list_screen(
        x,
        y,
        "A-Arkade Mint",
        "ARKADE MINT",
        [("My assets", "List / manage"), ("Mint asset", "Issue new"), ("Import", "By asset id"), ("Settings", "Mint prefs")],
    ),
    "A-Lendasat": lambda x, y: info_screen(x, y, "A-Lendasat", "LENDASAT", ["Bitcoin-backed lending", "In-app browser / partner"], cta="Open Lendasat"),
    "A-Satora": lambda x, y: info_screen(x, y, "A-Satora", "SATORA", ["Partner app surface", "In-app browser"], cta="Open Satora"),
    "A-Mint Asset": lambda x, y: info_screen(
        x, y, "A-Mint Asset", "MINT ASSET", ["Name / ticker / supply", "Precision / domain"], cta="Mint"
    ),
    "A-Import asset": lambda x, y: info_screen(
        x, y, "A-Import asset", "IMPORT ASSET", ["Paste asset id", "Verify before showing on home"], cta="Import"
    ),
    "A-Asset detail": lambda x, y: info_screen(
        x, y, "A-Asset detail", "ASSET", ["Ticker · balance", "Send / receive asset", "Reissue / burn (issuer)"]
    ),
    "A-Assets settings": lambda x, y: list_screen(
        x, y, "A-Assets settings", "MINT SETTINGS", [("Hide unverified", "ON"), ("Default precision", "8")]
    ),
    "A-Reissue": lambda x, y: info_screen(x, y, "A-Reissue", "REISSUE", ["Increase supply", "Issuer only"], cta="Reissue"),
    "A-Burn": lambda x, y: info_screen(x, y, "A-Burn", "BURN", ["Destroy units", "Irreversible"], cta="Burn"),
    # Notes
    "N-Notes form": lambda x, y: info_screen(
        x, y, "N-Notes form", "NOTES", ["Amount (sats)", "Memo (optional)", "Create note → share string"], cta="Create note"
    ),
    "N-Redeem": lambda x, y: info_screen(
        x, y, "N-Redeem", "REDEEM NOTE", ["Paste note string", "Validates and credits wallet"], cta="Redeem"
    ),
    "N-Success": lambda x, y: info_screen(x, y, "N-Success", "SUCCESS", ["Note created / redeemed", "Done → Home"], cta="Done"),
    # Detail
    "D-Unlock": lambda x, y: info_screen(
        x, y, "D-Unlock", "UNLOCK", ["Enter password", "Biometrics if enabled"], cta="Unlock"
    ),
    "D-Transaction": lambda x, y: info_screen(
        x,
        y,
        "D-Transaction",
        "TRANSACTION",
        ["+50,000 sats · received", "txid abc…", "Fee · status · explorer"],
        cta="Open explorer",
    ),
    "D-Bitcoin detail": lambda x, y: info_screen(
        x, y, "D-Bitcoin detail", "BITCOIN", ["Balance · fiat", "Receive / Send / Activity"], cta="Receive"
    ),
    "D-Scan": lambda x, y: info_screen(
        x, y, "D-Scan", "SCAN", ["Full-screen camera", "BIP21 / LN / note / address", "Home quick action"], cta="Close"
    ),
}

def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}

    # Ensure pages exist
    changes = []
    for pname, _rows in NEW_PAGES:
        if pname in pages:
            continue
        pid = uid()
        pages[pname] = pid
        changes.append({"type": "add-page", "id": pid, "name": pname})
        print("add page", pname)
    # If Settings exists, we'll wipe+rebuild it; rename old settings content
    if changes:
        revn, vern = push(c, revn, vern, changes)

    for pname, rows in NEW_PAGES:
        page_id = pages[pname]
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
        wipe = [
            {"type": "del-obj", "id": oid, "page-id": page_id}
            for oid, o in objs.items()
            if oid != ROOT and o.get("name") != "Root Frame"
        ]
        print(f"\n{pname}: wipe {len(wipe)}")
        if wipe:
            revn, vern = push(c, revn, vern, wipe, chunk=80)

        changes = []
        for ri, names in enumerate(rows):
            by = BOARD_Y + ri * ROW
            for ci, bname in enumerate(names):
                bx = ORIGIN_X + ci * COL
                builder = BUILDERS.get(bname)
                if not builder:
                    print("  MISSING BUILDER", bname)
                    continue
                fr, kids = builder(bx, by)
                fr["name"] = bname
                finish(changes, page_id, fr, kids)
                print(f"  + {bname} @ ({bx},{by})")
        revn, vern = push(c, revn, vern, changes, chunk=35)
        print(f"  pushed {len(changes)}")

    # Caption note on Settings page
    page_id = pages["06 Settings"]
    note = rb.make_text(
        "arkade-parity",
        40,
        20,
        1200,
        40,
        ROOT,
        ROOT,
        "Arkade wallet parity — Settings options from options.tsx + Apps/Notes/Detail flows",
        size=14,
        color="#8C8C8C",
        weight="700",
    )
    st, out = c.update(revn, vern, [{"type": "add-obj", "id": note["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": note}])
    print("caption", st, out.get("revn") if isinstance(out, dict) else out)

    # Summary
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    print("\n=== PAGES ===")
    for pid in meta["data"]["pages"]:
        name = meta["data"]["pagesIndex"][pid]["name"]
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={pid}")["objects"]
        frames = [o["name"] for o in objs.values() if o.get("type") == "frame" and not o["name"].startswith(("note", "Root"))]
        print(f"  {name}: {len(frames)} boards")
    print("DONE")


if __name__ == "__main__":
    main()
