#!/usr/bin/env python3
"""Replace Terms of Use boards (11b + 11b2) to match Expo TERMS_OF_USE_BODY."""
from __future__ import annotations

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("rb", Path(__file__).with_name("penpot_rebuild_clean.py"))
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

_spec3 = importlib.util.spec_from_file_location("r3", Path(__file__).with_name("penpot_apply_round3.py"))
r3 = importlib.util.module_from_spec(_spec3)
_spec3.loader.exec_module(r3)

FILE = rb.FILE
ROOT = rb.ROOT
PAGE_NAME = "00 Onboarding"
NOTE_SIDE_GAP = r3.NOTE_SIDE_GAP
PHONE_W = rb.PHONE_W

BOARDS = [
    ("11b Terms of Use (passkey)", "passkey"),
    ("11b2 Terms of Use (device only)", "device-only"),
]


def replace_board(c, page_id, objs, revn, vern, board_name, variant):
    frame = next((o for o in objs.values() if o.get("name") == board_name and o.get("type") == "frame"), None)
    if not frame:
        raise SystemExit(f"board {board_name!r} not found")
    ox, oy = float(frame["x"]), float(frame["y"])

    to_del = []
    for oid, o in objs.items():
        if oid == ROOT or o.get("name") == "Root Frame":
            continue
        name = o.get("name") or ""
        if name == board_name or name.startswith(f"note · {board_name}"):
            to_del.append(oid)
            continue
        if o.get("type") == "frame" and name.startswith("note ·") and abs(float(o.get("y", -9999)) - oy) < 2:
            if abs(float(o.get("x", 0)) - (ox + PHONE_W + NOTE_SIDE_GAP)) < 4:
                to_del.append(oid)

    deleted = set(to_del)
    for oid, o in objs.items():
        if o.get("frame-id") in deleted or o.get("parent-id") in deleted:
            if oid not in deleted and oid != ROOT:
                to_del.append(oid)
                deleted.add(oid)

    print(f"{board_name}: delete {len(to_del)} at ({ox:.0f},{oy:.0f})")
    if to_del:
        revn, vern = rb.push(
            c, revn, vern, [{"type": "del-obj", "id": i, "page-id": page_id} for i in to_del], chunk=80
        )

    changes = []
    fr, kids = rb.build_terms_of_use(ox, oy, variant)
    fr["shapes"] = [k["id"] for k in kids]
    r3.finish(changes, fr, kids, page_id)
    title, body = r3.NOTES[board_name]
    nfr, nkids = r3.make_note(board_name, title, body, ox + PHONE_W + NOTE_SIDE_GAP, oy)
    nfr["shapes"] = [k["id"] for k in nkids]
    r3.finish(changes, nfr, nkids, page_id)
    revn, vern = rb.push(c, revn, vern, changes, chunk=40)
    print(f"  DONE kids={len(kids)} revn={revn}")
    return revn, vern


def main():
    c = rb.Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}
    page_id = pages.get(PAGE_NAME) or pages.get("00 · Onboarding")
    if not page_id:
        raise SystemExit(f"missing onboarding page: {sorted(pages)}")

    for board_name, variant in BOARDS:
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
        revn, vern = replace_board(c, page_id, objs, revn, vern, board_name, variant)


if __name__ == "__main__":
    main()
