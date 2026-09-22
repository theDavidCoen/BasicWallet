#!/usr/bin/env python3
"""Fix Advanced Backup (encrypted Nostr/home server) + Restore seed board;
Send empty: circular scan FAB at bottom."""
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

_spec3 = importlib.util.spec_from_file_location("r3", Path(__file__).with_name("penpot_apply_round3.py"))
r3 = importlib.util.module_from_spec(_spec3)
_spec3.loader.exec_module(r3)

ORIGIN_X, BOARD_Y = 40, 320
PHONE_W = 390
NOTE_W, NOTE_SIDE_GAP = 320, 24
COL = PHONE_W + NOTE_SIDE_GAP + NOTE_W + 40


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
    body_o = rb.make_text("note-body", x + 14, y + 40, NOTE_W - 28, h - 54, fid, fid, body, size=10, color="#1A1A1A")
    frame["shapes"] = [title_o["id"], body_o["id"]]
    return [
        {"type": "add-obj", "id": frame["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": frame},
        {"type": "add-obj", "id": title_o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": title_o},
        {"type": "add-obj", "id": body_o["id"], "page-id": page_id, "frame-id": fid, "parent-id": fid, "obj": body_o},
    ]


def wipe_page(c, revn, vern, page_id):
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") != "Root Frame"
    ]
    if wipe:
        revn, vern = push(c, revn, vern, wipe, chunk=80)
    return revn, vern, len(wipe)


def place(changes, page_id, boards, notes, builders, layout_rows):
    for by, names in layout_rows:
        for col_i, bname in enumerate(names):
            bx = ORIGIN_X + col_i * COL
            fr, kids = builders[bname](bx, by)
            if bname in notes:
                changes.extend(make_note(page_id, *notes[bname], bx + PHONE_W + NOTE_SIDE_GAP, by))
            fr["shapes"] = [k["id"] for k in kids]
            add(changes, page_id, fr, ROOT, ROOT)
            for k in kids:
                add(changes, page_id, k, fr["id"], fr["id"])
            print(f"  + {bname}")


def main():
    c = Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}

    # --- Onboarding ---
    onb_notes = {
        "11 Onboarding Create": (
            "11 Onboarding",
            "CRITICAL: never expose seed in setup.\n"
            "Default = OS passkey + cloud.\n"
            "Advanced → 12 Advanced Backup.\n"
            "Footer → 12b Restore from seed.",
        ),
        "12 Advanced Backup": (
            "12 Advanced Backup",
            "Opt-in encrypted backups:\n"
            "1) Nostr relays\n"
            "2) Domestic / self-hosted server\n\n"
            "NOT seed reveal. Seed UI = Restore.",
        ),
        "12b Restore from seed": (
            "12b Restore",
            "From “Already have a wallet? Restore”.\n"
            "BIP39 + optional passphrase.\n"
            "This is NOT Advanced Backup.",
        ),
    }
    onb_builders = {
        "11 Onboarding Create": rb.BUILDERS["11 Onboarding Create"],
        "12 Advanced Backup": rb.build_backup,
        "12b Restore from seed": rb.build_restore,
    }
    pid = pages["00 Onboarding"]
    revn, vern, n = wipe_page(c, revn, vern, pid)
    print(f"wipe Onboarding {n}")
    changes = []
    place(
        changes,
        pid,
        None,
        onb_notes,
        onb_builders,
        [(BOARD_Y, ["11 Onboarding Create", "12 Advanced Backup", "12b Restore from seed"])],
    )
    revn, vern = push(c, revn, vern, changes)
    print("onboarding ok")

    # --- Send ---
    send_notes = {
        "03 Send empty": (
            "03 Send empty · RN",
            "Circular Scan FAB at bottom (48dp+).\n"
            "TextInput + KeyboardAvoidingView.\n"
            "Slide hidden until ready.",
        ),
        "03b Send ready": ("03b Ready mid/late", "Elastic fill → BLACK label."),
        "03c Send slide early": ("03c Early drag", "Elastic short → WHITE label."),
    }
    send_builders = {
        "03 Send empty": lambda x, y: r3.build_send(x, y, ready=False),
        "03b Send ready": lambda x, y: r3.build_send(x, y, ready=True),
        "03c Send slide early": lambda x, y: r3.build_send(x, y, ready=True, early=True),
    }
    pid = pages["03 Send"]
    revn, vern, n = wipe_page(c, revn, vern, pid)
    print(f"wipe Send {n}")
    changes = []
    place(
        changes,
        pid,
        None,
        send_notes,
        send_builders,
        [(BOARD_Y, ["03 Send empty", "03b Send ready", "03c Send slide early"])],
    )
    revn, vern = push(c, revn, vern, changes)
    print("DONE revn", revn)


if __name__ == "__main__":
    main()
