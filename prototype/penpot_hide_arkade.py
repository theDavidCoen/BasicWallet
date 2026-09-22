#!/usr/bin/env python3
"""Remove Arkade option complexity from Penpot Basic Wallet UI.

- Delete pages 10 Apps / 11 Notes / 12 Detail
- Rebuild 06 Settings with Basic-only screens (no S-* Arkade menu)
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

_spec = importlib.util.spec_from_file_location("r3", Path(__file__).with_name("penpot_apply_round3.py"))
r3 = importlib.util.module_from_spec(_spec)
# Avoid running round3 main
_spec.loader.exec_module(r3)

_rc = importlib.util.spec_from_file_location("rc", Path(__file__).with_name("penpot_rebuild_clean.py"))
rc = importlib.util.module_from_spec(_rc)
_rc.loader.exec_module(rc)

DELETE_PAGES = ["10 Apps", "11 Notes", "12 Detail"]

SETTINGS_BOARDS = [
    "05 Settings",
    "05as Arkade Settings",
    "05b Display currencies",
    "05c Privacy",
    "05d Nostr identity",
    "05e Backup",
    "05f About",
    "07 Hardware Wallet",
]

NOTES = {
    "05 Settings": (
        "05 Settings",
        "Display currencies on top.\n"
        "Account · Wallet Settings · Provider Settings sections.\n"
        "Arkade under Provider Settings · Reset red.",
    ),
    "05as Arkade Settings": (
        "05as Arkade Settings",
        "Delegates · Recovery · Collaborative Exit · Unilateral Exit (red).",
    ),
    "05b Display currencies": ("05b Currencies", "Toggle USD/EUR/… under sats."),
    "05c Privacy": ("05c Privacy", "Biometrics lock, app PIN, screen capture."),
    "05d Nostr identity": ("05d Nostr", "npub visible; nsec behind OS passkey."),
    "05e Backup": (
        "05e Backup",
        "Default OS passkey/cloud. Opt-in Nostr/home-server later. No seed by default.",
    ),
    "05f About": (
        "05f About",
        "Logo + app caption.\n"
        "Arkade ASP info · mode hd.\n"
        "Footer: version · license · GitHub\n"
        "(link only in real app UI).",
    ),
    "07 Hardware Wallet": ("07 Hardware", "BLE pairing. Slider hands off to device."),
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


def build_backup(ox, oy):
    return r3.build_settings_simple(
        ox,
        oy,
        "05e Backup",
        "BACKUP",
        [
            ("OS passkey / cloud", "default ON"),
            ("Nostr relay backup", "opt-in · later"),
            ("Home server", "opt-in · later"),
        ],
    )


def build_about(ox, oy):
    return r3.rb.build_about(ox, oy)


BUILDERS = {
    "05 Settings": rc.build_settings,
    "05as Arkade Settings": rc.build_arkade_settings,
    "05b Display currencies": lambda x, y: r3.build_settings_simple(
        x, y, "05b Display currencies", "CURRENCIES", [("USD", "ON"), ("EUR", "ON"), ("GBP", "OFF"), ("JPY", "OFF")]
    ),
    "05c Privacy": lambda x, y: r3.build_settings_simple(
        x,
        y,
        "05c Privacy",
        "PRIVACY",
        [("Biometrics lock", "ON"), ("App PIN", "Not set"), ("Block screenshots", "ON")],
    ),
    "05d Nostr identity": lambda x, y: r3.build_settings_simple(
        x,
        y,
        "05d Nostr identity",
        "NOSTR",
        [("npub", "npub1basic…"), ("NIP-05", "not set"), ("nsec", "behind OS passkey")],
    ),
    "05e Backup": build_backup,
    "05f About": build_about,
    "07 Hardware Wallet": r3.build_hw,
}


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}

    # 1) Delete Arkade-heavy pages
    dels = []
    for name in DELETE_PAGES:
        pid = pages.get(name)
        if not pid:
            print("skip missing", name)
            continue
        dels.append({"type": "del-page", "id": pid})
        print("del-page", name, pid)
    if dels:
        revn, vern = push(c, revn, vern, dels)
        # refresh page map
        meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}

    # 2) Rebuild Settings Basic-only
    page_id = pages["06 Settings"]
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") != "Root Frame"
    ]
    print(f"wipe Settings: {len(wipe)}")
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    COL, ORIGIN_X, BOARD_Y = r3.COL, r3.ORIGIN_X, r3.BOARD_Y
    PHONE_W, NOTE_SIDE_GAP = r3.PHONE_W, r3.NOTE_SIDE_GAP

    row1 = SETTINGS_BOARDS[:4]
    row2 = SETTINGS_BOARDS[4:]
    changes = []
    for by, names in [(BOARD_Y, row1), (BOARD_Y + 1004, row2)]:
        for col_i, bname in enumerate(names):
            bx = ORIGIN_X + col_i * COL
            fr, kids = BUILDERS[bname](bx, by)
            if bname in NOTES:
                changes.extend(r3.make_note(page_id, *NOTES[bname], bx + PHONE_W + NOTE_SIDE_GAP, by))
            fr["shapes"] = [k["id"] for k in kids]
            add(changes, page_id, fr, ROOT, ROOT)
            for k in kids:
                add(changes, page_id, k, fr["id"], fr["id"])
            print(f"  + {bname}")

    print(f"push Settings {len(changes)}")
    revn, vern = push(c, revn, vern, changes, chunk=35)
    print("DONE revn", revn)
    print("pages left:", sorted(pages.keys()))


if __name__ == "__main__":
    main()
