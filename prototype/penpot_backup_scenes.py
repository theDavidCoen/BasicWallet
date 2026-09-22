#!/usr/bin/env python3
"""Rebuild 00 Onboarding with Advanced Backup child scenes (12d Nostr, 12e Home server)."""
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
PHONE_W, NOTE_W, NOTE_SIDE_GAP = 390, 320, 24
COL = PHONE_W + NOTE_SIDE_GAP + NOTE_W + 40

ROWS = [
    ["11 Onboarding Create", "12 Advanced Backup"],
    ["12d Nostr backup", "12e Home server backup"],
    ["12b Restore seed", "12c Restore nsec"],
]

NOTES = {
    "11 Onboarding Create": (
        "11 Onboarding",
        "Footer → Restore (seed | nsec).\nAdvanced backup → 12.",
    ),
    "12 Advanced Backup": (
        "12 Advanced Backup",
        "Tap card → detail scene.\nNostr → 12d · Home → 12e.\nHide complexity: few fields only.",
    ),
    "12d Nostr backup": (
        "12d Nostr backup",
        "Default relays ON.\n+ Add relay.\nEnable encrypted backup.\nNo seed shown.",
    ),
    "12e Home server backup": (
        "12e Home server",
        "URL + optional token.\nTest connection → Enable.\nCiphertext only on server.",
    ),
    "12b Restore seed": ("12b Restore · seed", "BIP39 path."),
    "12c Restore nsec": ("12c Restore · nsec", "Nostr backup restore path."),
}

BUILDERS = {
    "11 Onboarding Create": rb.build_onboarding,
    "12 Advanced Backup": rb.build_backup,
    "12d Nostr backup": rb.build_nostr_backup,
    "12e Home server backup": rb.build_home_server_backup,
    "12b Restore seed": lambda x, y: rb.build_restore(x, y, mode="seed"),
    "12c Restore nsec": lambda x, y: rb.build_restore(x, y, mode="nsec"),
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


def make_note(page_id, title, body, x, y):
    lines = sum(max(1, (len(b) // 42) + 1) for b in body.split("\n"))
    h = max(140, min(280, 54 + lines * 15))
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
    t = rb.make_text("note-title", x + 14, y + 12, NOTE_W - 28, 22, fid, fid, title, size=12, color="#1A1A1A", weight="700")
    b = rb.make_text("note-body", x + 14, y + 40, NOTE_W - 28, h - 54, fid, fid, body, size=10, color="#1A1A1A")
    frame["shapes"] = [t["id"], b["id"]]
    return [
        {"type": "add-obj", "id": frame["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame},
        {"type": "add-obj", "id": t["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": t},
        {"type": "add-obj", "id": b["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": b},
    ]


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}
    page_id = pages["00 Onboarding"]

    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") != "Root Frame"
    ]
    print("wipe", len(wipe))
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)

    changes = []
    for row_i, names in enumerate(ROWS):
        by = BOARD_Y + row_i * 1004
        for col_i, bname in enumerate(names):
            bx = ORIGIN_X + col_i * COL
            fr, kids = BUILDERS[bname](bx, by)
            if bname in NOTES:
                changes.extend(make_note(page_id, *NOTES[bname], bx + PHONE_W + NOTE_SIDE_GAP, by))
            fr["shapes"] = [k["id"] for k in kids]
            add(changes, page_id, fr, ROOT, ROOT)
            for k in kids:
                add(changes, page_id, k, fr["id"], fr["id"])
            print("+", bname)

    revn, vern = push(c, revn, vern, changes)
    print("DONE", revn)


if __name__ == "__main__":
    main()
