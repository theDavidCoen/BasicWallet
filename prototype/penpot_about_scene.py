#!/usr/bin/env python3
"""Replace only the 05f About board (+ yellow note) on the Settings page."""
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
BOARD = "05f About"
PAGE_NAME = "06 Settings"
NOTE_SIDE_GAP = r3.NOTE_SIDE_GAP
PHONE_W = rb.PHONE_W


def main():
    c = rb.Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}
    if PAGE_NAME not in pages:
        raise SystemExit(f"missing page {PAGE_NAME}: {sorted(pages)}")
    page_id = pages[PAGE_NAME]
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]

    about = next((o for o in objs.values() if o.get("name") == BOARD and o.get("type") == "frame"), None)
    if not about:
        raise SystemExit(f"board {BOARD!r} not found on {PAGE_NAME}")
    ox, oy = float(about["x"]), float(about["y"])

    # Delete About frame and its yellow note (same y, to the right)
    to_del = []
    for oid, o in objs.items():
        if oid == ROOT or o.get("name") == "Root Frame":
            continue
        name = o.get("name") or ""
        if name == BOARD or name.startswith(f"note · {BOARD}") or name == f"note · 05f About":
            to_del.append(oid)
            continue
        # yellow notes created by round3 use board name in title text, frame name "note · …"
        if o.get("type") == "frame" and name.startswith("note ·") and abs(float(o.get("y", -9999)) - oy) < 2:
            # only the note next to About (x just right of phone)
            if abs(float(o.get("x", 0)) - (ox + PHONE_W + NOTE_SIDE_GAP)) < 4:
                to_del.append(oid)

    # Also delete descendants of deleted frames (Penpot may cascade; be explicit)
    deleted = set(to_del)
    for oid, o in objs.items():
        if o.get("frame-id") in deleted or o.get("parent-id") in deleted:
            if oid not in deleted and oid != ROOT:
                to_del.append(oid)
                deleted.add(oid)

    print(f"delete {len(to_del)} objs at ({ox:.0f},{oy:.0f})")
    if to_del:
        revn, vern = rb.push(
            c, revn, vern, [{"type": "del-obj", "id": i, "page-id": page_id} for i in to_del], chunk=80
        )

    changes = []
    fr, kids = rb.build_about(ox, oy)
    fr["shapes"] = [k["id"] for k in kids]
    r3.finish(changes, fr, kids, page_id)
    title, body = r3.NOTES[BOARD]
    nfr, nkids = r3.make_note(BOARD, title, body, ox + PHONE_W + NOTE_SIDE_GAP, oy)
    nfr["shapes"] = [k["id"] for k in nkids]
    r3.finish(changes, nfr, nkids, page_id)

    revn, vern = rb.push(c, revn, vern, changes, chunk=40)
    print(f"DONE {BOARD} revn={revn} kids={len(kids)}")


if __name__ == "__main__":
    main()
