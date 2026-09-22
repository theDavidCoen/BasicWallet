#!/usr/bin/env python3
"""Refresh Penpot Settings hub + Arkade Settings board to match Expo layout."""
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

_spec = importlib.util.spec_from_file_location("rc", Path(__file__).with_name("penpot_rebuild_clean.py"))
rc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rc)

_r3 = importlib.util.spec_from_file_location("r3", Path(__file__).with_name("penpot_apply_round3.py"))
r3 = importlib.util.module_from_spec(_r3)
_r3.loader.exec_module(r3)

TARGETS = ["05 Settings", "05as Arkade Settings"]
NOTES = {
    "05 Settings": (
        "05 Settings",
        "Display currencies on top.\n"
        "Account: Privacy · Nostr · Contacts · Duress PIN.\n"
        "Wallet Settings: node · HW · Multisig · Backup · Restore.\n"
        "Provider Settings: Arkade.\n"
        "Footer: Reset (red) · About.",
    ),
    "05as Arkade Settings": (
        "05as Arkade",
        "Hub row label: Arkade (under Provider Settings).\n"
        "Delegates · Recovery address · Collaborative Exit ·\n"
        "Unilateral Exit (red).",
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
        {
            "type": "add-obj",
            "id": obj["id"],
            "page-id": page_id,
            "frame-id": frame,
            "parent-id": parent,
            "obj": obj,
        }
    )


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}
    page_id = pages.get("06 Settings")
    if not page_id:
        raise SystemExit(f"page 06 Settings missing; have {sorted(pages)}")

    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    positions = {}
    board_ids = set()
    for oid, o in objs.items():
        if oid == ROOT or o.get("name") == "Root Frame":
            continue
        name = o.get("name") or ""
        if name in TARGETS or name.startswith("note · 05 Settings") or name.startswith("note · 05as"):
            if name in TARGETS:
                positions[name] = (float(o.get("x", 0)), float(o.get("y", 0)))
            board_ids.add(oid)

    changed = True
    while changed:
        changed = False
        for oid, o in objs.items():
            if oid in board_ids:
                continue
            if o.get("frame-id") in board_ids or o.get("parent-id") in board_ids:
                board_ids.add(oid)
                changed = True

    wipe = [{"type": "del-obj", "id": oid, "page-id": page_id} for oid in board_ids]
    print(f"delete {len(wipe)} objs; existing boards={list(positions)}")
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    COL = 460
    default_x, default_y = 40.0, 320.0
    if "05 Settings" in positions:
        default_x, default_y = positions["05 Settings"]
    pos = {
        "05 Settings": positions.get("05 Settings", (default_x, default_y)),
        "05as Arkade Settings": positions.get("05as Arkade Settings", (default_x + COL, default_y)),
    }

    builders = {
        "05 Settings": rc.build_settings,
        "05as Arkade Settings": rc.build_arkade_settings,
    }

    changes = []
    for name in TARGETS:
        bx, by = pos[name]
        fr, kids = builders[name](bx, by)
        fr["shapes"] = [k["id"] for k in kids]
        add(changes, page_id, fr, ROOT, ROOT)
        for k in kids:
            add(changes, page_id, k, fr["id"], fr["id"])
        note_title, note_body = NOTES[name]
        nfr, nkids = r3.make_note(name, note_title, note_body, bx + rc.PHONE_W + 24, by)
        nfr["shapes"] = [k["id"] for k in nkids]
        add(changes, page_id, nfr, ROOT, ROOT)
        for k in nkids:
            add(changes, page_id, k, nfr["id"], nfr["id"])
        print(f"+ {name} @ ({bx:.0f},{by:.0f}) kids={len(kids)} h={fr.get('height')}")

    print(f"push {len(changes)} changes")
    revn, vern = push(c, revn, vern, changes, chunk=35)
    print("DONE revn", revn)


if __name__ == "__main__":
    main()
