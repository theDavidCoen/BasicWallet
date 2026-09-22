#!/usr/bin/env python3
"""Build page «11 Prototype» with curated boards + clickable interactions.

Penpot View Mode only navigates within a single page, so design pages stay as
the source of truth and this page holds the playable flow.

11d Ready uses after-delay 2000ms → Home (no Open wallet CTA).
"""
from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path

_spec = importlib.util.spec_from_file_location("rb", Path(__file__).with_name("penpot_rebuild_clean.py"))
rb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rb)

FILE = rb.FILE
ROOT = rb.ROOT
ORIGIN_X, BOARD_Y = 40, 120
COL, ROW = 460, 920
PAGE_NAME = "11 Prototype"

# Curated boards for the interactive demo (same builders as design pages).
PROTO_BOARDS = [
    "11 Onboarding Create",
    "11b Terms of Use (passkey)",
    "11b2 Terms of Use (device only)",
    "11c Passkey not found",
    "11d Ready",
    "12 Advanced Backup",
    "12d Nostr backup",
    "12e Home server backup",
    "12f Import nsec warning",
    "12b Restore seed",
    "12c Restore nsec",
    "12h Restore home server",
    "14 Add wallet",
    "14b Create without passkey",
    "14c Name new wallet",
    "01 Home",
    "01b Home privacy",
    "01c Wallet switcher",
    "01d Activity sheet",
    "01h Transaction details",
    "02 Receive BIP21",
    "02b Receive sheet",
    "03 Send empty",
    "03b Send ready",
    "03c Send slide early",
    "03d Send slide mid",
    "03e Send success",
    "03f Scan QR",
    "04 Swap BTC to USDT",
    "04b Swap success",
    "05 Settings",
    "05b Display currencies",
    "05c Privacy",
    "05d Nostr identity",
    "05e Backup",
    "05f About",
    "05g Duress PIN",
    "05h Passkey status",
    "05i Export nsec warning",
    "05j Export nsec reveal",
    "05k Generate identity warning",
    "11e Export recovery phrase",
    "07 Hardware Wallet",
    "07b Pair hardware",
    "07c Confirm on device",
    "08 Contacts",
    "08e Add contact",
    "08b Choose Recipient",
    "06 Connect Node",
    "13 Node Status",
    "10 Multisig",
    "10e Create vault",
    "10f Import descriptor",
]


def nav(dest, *, animation=True):
    inter = {
        "event-type": "click",
        "action-type": "navigate",
        "destination": dest,
        "preserve-scroll": False,
    }
    if animation:
        inter["animation"] = {"animation-type": "dissolve", "duration": 280, "easing": "ease"}
    return inter


def delay_nav(dest, ms=2000):
    return {
        "event-type": "after-delay",
        "action-type": "navigate",
        "destination": dest,
        "delay": ms,
        "preserve-scroll": False,
        "animation": {"animation-type": "dissolve", "duration": 320, "easing": "ease"},
    }


def overlay(dest):
    return {
        "event-type": "click",
        "action-type": "open-overlay",
        "destination": dest,
        "overlay-pos-type": "center",
        "close-click-outside": True,
        "background-overlay": True,
    }


def close_overlay():
    return {"event-type": "click", "action-type": "close-overlay", "destination": None}


def prev_screen():
    return {"event-type": "click", "action-type": "prev-screen"}


def find_by_name(kids, *names):
    want = set(names)
    return [k for k in kids if k.get("name") in want]


def set_inter(shapes, inter):
    for s in shapes:
        s["interactions"] = [inter] if not isinstance(inter, list) else inter


def wire(boards: dict[str, tuple[dict, list]]):
    """Attach interactions using board name → (frame, kids)."""
    fid = {name: fr["id"] for name, (fr, _) in boards.items()}

    def f(name):
        return fid[name]

    # Logo tap → Home on every board (product rule)
    home_id = f("01 Home")
    for _name, (fr, kids) in boards.items():
        set_inter(find_by_name(kids, "logo-B", "logo-asic"), nav(home_id))

    # --- Onboarding ---
    fr, kids = boards["11 Onboarding Create"]
    set_inter(find_by_name(kids, "b1", "b1l"), nav(f("11b Terms of Use (passkey)")))
    set_inter(find_by_name(kids, "b2", "b2l"), nav(f("11b2 Terms of Use (device only)")))
    set_inter(find_by_name(kids, "restore"), nav(f("12b Restore seed")))

    fr, kids = boards["11b Terms of Use (passkey)"]
    set_inter(find_by_name(kids, "cta", "ctal", "continue", "b1", "b1l"), nav(f("11d Ready")))

    fr, kids = boards["11b2 Terms of Use (device only)"]
    set_inter(find_by_name(kids, "cta", "ctal", "continue", "b1", "b1l"), nav(f("12 Advanced Backup")))

    fr, kids = boards["11d Ready"]
    fr["interactions"] = [delay_nav(f("01 Home"), 2000)]

    fr, kids = boards["12 Advanced Backup"]
    set_inter(find_by_name(kids, "opt-nostr", "n-t", "n-d", "n-ch"), nav(f("12d Nostr backup")))
    set_inter(find_by_name(kids, "opt-home", "h-t", "h-d", "h-ch"), nav(f("12e Home server backup")))

    fr, kids = boards["12d Nostr backup"]
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("11d Ready")))

    fr, kids = boards["12e Home server backup"]
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("11d Ready")))

    # Restore hub tabs
    fr, kids = boards["12b Restore seed"]
    set_inter(find_by_name(kids, "st-nsec", "seg-nsec"), nav(f("12c Restore nsec")))
    set_inter(find_by_name(kids, "st-server", "seg-server"), nav(f("12h Restore home server")))
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("11d Ready")))

    fr, kids = boards["12c Restore nsec"]
    set_inter(find_by_name(kids, "st-seed", "seg-seed"), nav(f("12b Restore seed")))
    set_inter(find_by_name(kids, "st-server", "seg-server"), nav(f("12h Restore home server")))
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("11d Ready")))

    fr, kids = boards["12h Restore home server"]
    set_inter(find_by_name(kids, "st-seed", "seg-seed"), nav(f("12b Restore seed")))
    set_inter(find_by_name(kids, "st-nsec", "seg-nsec"), nav(f("12c Restore nsec")))
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("11d Ready")))

    fr, kids = boards["11c Passkey not found"]
    set_inter(find_by_name(kids, "st-nsec", "seg-nsec"), nav(f("12c Restore nsec")))
    set_inter(find_by_name(kids, "st-server", "seg-server"), nav(f("12h Restore home server")))
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("11d Ready")))

    fr, kids = boards["12f Import nsec warning"]
    set_inter(find_by_name(kids, "go", "gol", "cta", "ctal"), nav(f("12c Restore nsec")))
    set_inter(find_by_name(kids, "back", "backl", "cancel"), nav(f("05d Nostr identity")))

    # Add wallet (extra)
    fr, kids = boards["14 Add wallet"]
    set_inter(find_by_name(kids, "a", "at", "ad"), nav(f("14c Name new wallet")))
    set_inter(find_by_name(kids, "b", "bt", "bd"), nav(f("14b Create without passkey")))

    fr, kids = boards["14b Create without passkey"]
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("14c Name new wallet")))

    fr, kids = boards["14c Name new wallet"]
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("01 Home")))

    # --- Home ---
    fr, kids = boards["01 Home"]
    # Product: tap-and-hold empty space → Settings.
    # Penpot has no long-press; empty-area click on the board ≈ that gesture.
    fr["interactions"] = [
        {
            "event-type": "click",
            "action-type": "navigate",
            "destination": f("05 Settings"),
            "preserve-scroll": False,
            "animation": {"animation-type": "dissolve", "duration": 280, "easing": "ease"},
        }
    ]
    set_inter(find_by_name(kids, "btn-receive", "label-receive"), nav(f("02 Receive BIP21")))
    set_inter(find_by_name(kids, "btn-send", "label-send"), nav(f("03 Send empty")))
    set_inter(find_by_name(kids, "swap-ico"), nav(f("04 Swap BTC to USDT")))
    set_inter(find_by_name(kids, "balance", "fiat"), nav(f("01b Home privacy")))
    set_inter(find_by_name(kids, "avatar-ring", "avatar-plus"), overlay(f("01c Wallet switcher")))
    set_inter(find_by_name(kids, "hist-hint", "hist-chevron"), overlay(f("01d Activity sheet")))

    fr, kids = boards["01b Home privacy"]
    fr["interactions"] = [
        {
            "event-type": "click",
            "action-type": "navigate",
            "destination": f("05 Settings"),
            "preserve-scroll": False,
            "animation": {"animation-type": "dissolve", "duration": 280, "easing": "ease"},
        }
    ]
    set_inter(find_by_name(kids, "balance", "fiat"), nav(f("01 Home")))
    set_inter(find_by_name(kids, "btn-receive", "label-receive"), nav(f("02 Receive BIP21")))
    set_inter(find_by_name(kids, "btn-send", "label-send"), nav(f("03 Send empty")))
    set_inter(find_by_name(kids, "swap-ico"), nav(f("04 Swap BTC to USDT")))
    set_inter(find_by_name(kids, "avatar-ring", "avatar-plus"), overlay(f("01c Wallet switcher")))

    fr, kids = boards["01c Wallet switcher"]
    set_inter(find_by_name(kids, "scrim", "grab"), close_overlay())
    set_inter(find_by_name(kids, "add", "add-l"), nav(f("14 Add wallet")))
    set_inter(find_by_name(kids, "ln", "ln-l"), nav(f("06 Connect Node")))

    fr, kids = boards["01d Activity sheet"]
    set_inter(find_by_name(kids, "scrim", "grab"), close_overlay())
    set_inter(find_by_name(kids, "a0-bg", "a0-t", "a1-bg"), nav(f("01h Transaction details")))

    fr, kids = boards["01h Transaction details"]
    set_inter(find_by_name(kids, "title", "amt", "badge", "badgel"), nav(f("01 Home")))

    # --- Receive ---
    fr, kids = boards["02 Receive BIP21"]
    set_inter(find_by_name(kids, "copy-l", "pill", "bip21", "ico-copy"), overlay(f("02b Receive sheet")))
    set_inter(find_by_name(kids, "share-l", "ico-share"), nav(f("01 Home")))
    set_inter(find_by_name(kids, "title"), nav(f("01 Home")))

    fr, kids = boards["02b Receive sheet"]
    set_inter(find_by_name(kids, "scrim", "grab"), close_overlay())

    # --- Send ---
    fr, kids = boards["03 Send empty"]
    set_inter(find_by_name(kids, "btn", "choose"), nav(f("08b Choose Recipient")))
    set_inter(find_by_name(kids, "scan-circle", "scan"), nav(f("03f Scan QR")))
    set_inter(find_by_name(kids, "f-amt", "ph-amt", "v-amt"), nav(f("03b Send ready")))

    fr, kids = boards["08b Choose Recipient"]
    set_inter(find_by_name(kids, "paste", "pastel"), nav(f("03b Send ready")))
    for prefix in ("c0", "pr0", "n0"):
        set_inter(find_by_name(kids, f"{prefix}-bg"), nav(f("03b Send ready")))

    fr, kids = boards["03f Scan QR"]
    set_inter(find_by_name(kids, "paste", "pastel", "cancel", "vf"), nav(f("03b Send ready")))

    fr, kids = boards["03b Send ready"]
    set_inter(find_by_name(kids, "slider", "slide", "slider-elastic", "handle-gt"), nav(f("03c Send slide early")))

    fr, kids = boards["03c Send slide early"]
    set_inter(find_by_name(kids, "slider", "slide", "slider-elastic", "handle-gt"), nav(f("03d Send slide mid")))

    fr, kids = boards["03d Send slide mid"]
    set_inter(find_by_name(kids, "slider", "slide", "slider-elastic", "handle-gt"), nav(f("03e Send success")))

    fr, kids = boards["03e Send success"]
    set_inter(find_by_name(kids, "det", "detl"), nav(f("01h Transaction details")))
    set_inter(find_by_name(kids, "done", "donel"), nav(f("01 Home")))

    # --- Swap ---
    fr, kids = boards["04 Swap BTC to USDT"]
    set_inter(find_by_name(kids, "slider", "slide", "slider-elastic", "handle-gt"), nav(f("04b Swap success")))

    fr, kids = boards["04b Swap success"]
    set_inter(find_by_name(kids, "done", "donel"), nav(f("01 Home")))

    # --- Settings hub (all rows) ---
    # s0 Display currencies, s1 Privacy, s2 Passkey, s3 Connected node, s4 Nostr,
    # s5 Hardware, s6 Contacts, s7 Multisig, s8 Backup, s9 Duress PIN, s10 About
    fr, kids = boards["05 Settings"]
    mapping = {
        "s0": "05b Display currencies",
        "s1": "05c Privacy",
        "s2": "05h Passkey status",
        "s3": "06 Connect Node",
        "s4": "05d Nostr identity",
        "s5": "07 Hardware Wallet",
        "s6": "08 Contacts",
        "s7": "10 Multisig",
        "s8": "05e Backup",
        "s9": "05g Duress PIN",
        "s10": "05f About",
    }
    for prefix, dest in mapping.items():
        set_inter(find_by_name(kids, f"{prefix}-bg", f"{prefix}-t", f"{prefix}-ch"), nav(f(dest)))

    # Settings leaves → back via title to Settings hub (logo still → Home)
    for leaf in (
        "05b Display currencies",
        "05c Privacy",
        "05f About",
        "05g Duress PIN",
        "05h Passkey status",
        "05e Backup",
        "05d Nostr identity",
        "11e Export recovery phrase",
        "07 Hardware Wallet",
    ):
        fr, kids = boards[leaf]
        set_inter(find_by_name(kids, "title"), nav(f("05 Settings")))

    fr, kids = boards["05d Nostr identity"]
    set_inter(find_by_name(kids, "ex-bg", "ex-t", "ex-ch"), nav(f("05i Export nsec warning")))
    set_inter(find_by_name(kids, "im-bg", "im-t", "im-ch"), nav(f("12f Import nsec warning")))
    set_inter(find_by_name(kids, "gen"), nav(f("05k Generate identity warning")))
    set_inter(find_by_name(kids, "nb-bg", "nb-t", "nb-ch"), nav(f("05e Backup")))

    fr, kids = boards["05i Export nsec warning"]
    set_inter(find_by_name(kids, "go", "gol"), nav(f("05j Export nsec reveal")))
    set_inter(find_by_name(kids, "cancel"), nav(f("05d Nostr identity")))

    fr, kids = boards["05j Export nsec reveal"]
    set_inter(find_by_name(kids, "done", "donel", "copy", "copyl"), nav(f("05d Nostr identity")))

    fr, kids = boards["05k Generate identity warning"]
    set_inter(find_by_name(kids, "go", "gol"), nav(f("05d Nostr identity")))
    set_inter(find_by_name(kids, "cancel"), nav(f("05d Nostr identity")))

    fr, kids = boards["05h Passkey status"]
    set_inter(find_by_name(kids, "n0-bg", "n0-t", "n0-ch"), nav(f("11e Export recovery phrase")))
    set_inter(find_by_name(kids, "n1-bg", "n1-t", "n1-ch"), nav(f("05e Backup")))

    fr, kids = boards["05e Backup"]
    set_inter(find_by_name(kids, "b1-bg", "b1-t", "b1-ch"), nav(f("11e Export recovery phrase")))
    set_inter(find_by_name(kids, "b2-bg", "b2-t", "b2-ch"), nav(f("12d Nostr backup")))
    set_inter(find_by_name(kids, "b3-bg", "b3-t", "b3-ch"), nav(f("12e Home server backup")))
    set_inter(find_by_name(kids, "b4-bg", "b4-t", "b4-ch"), nav(f("12b Restore seed")))

    fr, kids = boards["05g Duress PIN"]
    set_inter(find_by_name(kids, "save", "savel"), nav(f("05 Settings")))

    fr, kids = boards["11e Export recovery phrase"]
    set_inter(find_by_name(kids, "done", "donel", "cta", "ctal", "copy", "copyl"), nav(f("05e Backup")))

    fr, kids = boards["07 Hardware Wallet"]
    set_inter(find_by_name(kids, "pair", "pairl", "h0-bg", "h1-bg"), nav(f("07b Pair hardware")))

    fr, kids = boards["07b Pair hardware"]
    set_inter(find_by_name(kids, "cancel", "cancell"), nav(f("07 Hardware Wallet")))
    set_inter(find_by_name(kids, "scan", "scanl", "dev-bg"), nav(f("07c Confirm on device")))

    fr, kids = boards["07c Confirm on device"]
    set_inter(find_by_name(kids, "cancel", "cancell"), nav(f("03e Send success")))

    # --- Contacts ---
    fr, kids = boards["08 Contacts"]
    set_inter(find_by_name(kids, "add", "add-l"), nav(f("08e Add contact")))

    fr, kids = boards["08e Add contact"]
    set_inter(find_by_name(kids, "save", "savel"), nav(f("08 Contacts")))
    set_inter(find_by_name(kids, "cancel"), nav(f("08 Contacts")))

    # --- Node ---
    fr, kids = boards["06 Connect Node"]
    set_inter(find_by_name(kids, "n0-bg", "n1-bg", "n2-bg"), nav(f("13 Node Status")))

    fr, kids = boards["13 Node Status"]
    set_inter(find_by_name(kids, "done", "donel", "disconnect"), nav(f("01 Home")))

    # --- Multisig ---
    fr, kids = boards["10 Multisig"]
    set_inter(find_by_name(kids, "crt-bg", "crt-t", "btn", "bl"), nav(f("10e Create vault")))
    set_inter(find_by_name(kids, "imp"), nav(f("10f Import descriptor")))
    set_inter(find_by_name(kids, "inv-bg", "inv-t"), nav(f("10e Create vault")))

    fr, kids = boards["10e Create vault"]
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("10 Multisig")))

    fr, kids = boards["10f Import descriptor"]
    set_inter(find_by_name(kids, "cta", "ctal"), nav(f("10 Multisig")))


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
    print(f"created {PAGE_NAME} -> {pages[PAGE_NAME]}")
    return pages, revn, vern, pages[PAGE_NAME]


def layout_pos(i):
    col = i % 4
    row = i // 4
    return ORIGIN_X + col * COL, BOARD_Y + row * ROW


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


def main():
    missing = [n for n in PROTO_BOARDS if n not in rb.BUILDERS]
    if missing:
        raise SystemExit(f"missing builders: {missing}")

    c = rb.Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][p]["name"]: p for p in meta["data"]["pages"]}
    pages, revn, vern, page_id = ensure_page(c, revn, vern, pages)

    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    stale_flows = list((meta["data"]["pagesIndex"][page_id].get("flows") or {}).keys())

    wipe = [
        {"type": "del-obj", "id": oid, "page-id": page_id}
        for oid, o in objs.items()
        if oid != ROOT and o.get("name") != "Root Frame"
    ]
    print(f"wipe {PAGE_NAME}: {len(wipe)} objs, {len(stale_flows)} flows")
    if wipe:
        revn, vern = rb.push(c, revn, vern, wipe, chunk=80)

    boards: dict[str, tuple[dict, list]] = {}
    for i, name in enumerate(PROTO_BOARDS):
        ox, oy = layout_pos(i)
        fr, kids = rb.BUILDERS[name](ox, oy)
        boards[name] = (fr, kids)
        print(f"  build {name}")

    wire(boards)

    # Count wired interactions
    wired = 0
    for fr, kids in boards.values():
        if fr.get("interactions"):
            wired += 1
        for k in kids:
            if k.get("interactions"):
                wired += 1
    print(f"hotspots+boards with interactions: {wired}")

    changes = []
    # Add boards bottom→top so Onboarding ends on top of z-stack (viewer index 0
    # prefers topmost frames in some Penpot builds; also wipe stale flows below).
    for name in reversed(PROTO_BOARDS):
        fr, kids = boards[name]
        finish(changes, fr, kids, page_id)

    # Drop every existing flow (stale startingFrame → wrong screen e.g. Import)
    for fid in stale_flows:
        changes.append({"type": "set-flow", "page-id": page_id, "id": fid, "params": None})

    # Flows: Main starts at onboarding; App at Home
    flow_main = str(uuid.uuid4())
    flow_home = str(uuid.uuid4())
    onb_id = boards["11 Onboarding Create"][0]["id"]
    home_id = boards["01 Home"][0]["id"]
    changes.append(
        {
            "type": "set-flow",
            "page-id": page_id,
            "id": flow_main,
            "params": {
                "id": flow_main,
                "name": "Onboarding → Home",
                "starting-frame": onb_id,
            },
        }
    )
    changes.append(
        {
            "type": "set-flow",
            "page-id": page_id,
            "id": flow_home,
            "params": {
                "id": flow_home,
                "name": "App · Home",
                "starting-frame": home_id,
            },
        }
    )

    print(f"push {len(changes)} changes")
    revn, vern = rb.push(c, revn, vern, changes, chunk=40)
    print(f"DONE {PAGE_NAME} revn {revn}")
    print(
        f"View (Onboarding): {rb.BASE}/#/view?file-id={FILE}&page-id={page_id}&frame-id={onb_id}"
    )
    print(
        f"View (Home):       {rb.BASE}/#/view?file-id={FILE}&page-id={page_id}&frame-id={home_id}"
    )


if __name__ == "__main__":
    main()
