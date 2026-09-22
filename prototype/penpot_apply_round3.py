#!/usr/bin/env python3
"""Round 3 Penpot apply: wipe+rebuild selected pages.

Uses builders from penpot_rebuild_clean (canonical phone frames).
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
ORIGIN_X, BOARD_Y = 40, 320
NOTE_W = 320
NOTE_SIDE_GAP = 24
PHONE_W = rb.PHONE_W
COL = 390 + NOTE_SIDE_GAP + NOTE_W + 40  # ~774

REBUILD_PAGES = {
    "00 Onboarding": [
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
    ],
    "10 Add wallet": [
        "14 Add wallet",
        "14b Create without passkey",
        "14c Name new wallet",
    ],
    "01 Home": [
        "01 Home",
        "01b Home privacy",
        "01c Wallet switcher",
        "01j Edit wallet",
        "01k Remove wallet warning",
        "01m Remove Lightning warning",
        "01d Activity sheet",
        "01h Transaction details",
        "01i Transaction details LN",
        "01e Lock biometrics",
        "01f Lock PIN",
        "01g Duress Home",
    ],
    "02 Receive": [
        "02 Receive BIP21",
        "02d Receive POS",
        "02b Receive sheet",
        "02c Receive share sheet",
    ],
    "03 Send": [
        "03 Send empty",
        "03b Send ready",
        "03c Send slide early",
        "03d Send slide mid",
        "03e Send success",
        "03f Scan QR",
    ],
    "04 Swap": [
        "04 Swap BTC to USDT",
        "04b Swap success",
    ],
    "05 Node": [
        "06 Connect Node",
        "06b Connect BTCPay",
        "06c Connect NWC",
        "06d Connect Manual LND",
        "13 Node Status",
    ],
    "06 Settings": [
        "05 Settings",
        "05b Display currencies",
        "05c Privacy",
        "05d Nostr identity",
        "05i Export nsec warning",
        "05j Export nsec reveal",
        "05k Generate identity warning",
        "05e Backup",
        "05f About",
        "05g Duress PIN",
        "05h Passkey status",
        "11e Export recovery phrase",
        "07 Hardware Wallet",
        "07b Pair hardware",
        "07c Confirm on device",
    ],
    "07 Contacts": [
        "08 Contacts",
        "08d Contacts search",
        "08b Choose Recipient",
        "08c Edit contact",
        "08e Add contact",
    ],
    "08 Nostr": [
        "09 Nostr inbox",
        "09b Compose request",
        "09c Incoming pay",
        "09d Outgoing pending",
        "09e Accepted address",
        "09f Declined / expired",
    ],
    "09 Multisig": [
        "10 Multisig",
        "10b Multisig invite",
        "10c Multisig pending",
        "10d Multisig cosign",
        "10e Create vault",
        "10f Import descriptor",
    ],
}

NOTES = {
    "11 Onboarding Create": (
        "11 Onboarding · Create",
        "Caption: Your payments app. / No seed\n"
        "phrase / OS passkey + multi-cloud backups.\n"
        "Primary CTA: Continue (passkey).\n"
        "Text under it: Continue without passkey\n"
        "→ Terms (device-only) → Advanced Backup.\n"
        "Footer: Seed phrase or nsec? Restore here.\n"
        "NEVER seed create/export on first run.",
    ),
    "11b Terms of Use (passkey)": (
        "11b Terms · passkey",
        "Title TERMS OF USE.\n"
        "Card: Across your devices ONLY.\n"
        "Passkey path is always cross-device.\n"
        "Zero-knowledge responsibilities.\n"
        "CTA → Ready.",
    ),
    "11b2 Terms of Use (device only)": (
        "11b2 Terms · device only",
        "Title TERMS OF USE.\n"
        "Card: This device only ONLY.\n"
        "Same ZK responsibilities.\n"
        "CTA → Advanced Backup.",
    ),
    "11c Passkey not found": (
        "11c Passkey missing",
        "From Continue (passkey) when\n"
        "no match. Same Seed|nsec|Server hub\n"
        "+ try other account / Create NEW.\n"
        "Never silent new wallet.",
    ),
    "12 Advanced Backup": (
        "12 Advanced Backup",
        "Reached via Terms (device-only) after\n"
        "Continue without passkey.\n"
        "Nostr or Home server package.\n"
        "No scene numbers in UI. No seed reveal.",
    ),
    "12d Nostr backup": (
        "12d Nostr backup",
        "AEAD package + passphrase ALWAYS.\n"
        "Caption always: lose passphrase =\n"
        "lose wallets · save offline.",
    ),
    "12e Home server backup": (
        "12e Home server",
        "Same package + passphrase.\n"
        "Same loss caption as Nostr.",
    ),
    "12f Import nsec warning": (
        "12f Import nsec gate",
        "Social nsec allowed.\nPassphrase always required.",
    ),
    "12b Restore seed": (
        "12b Restore · Seed | nsec | Server",
        "From «No passkey? Restore here.»\n"
        "Caption: won't use Passkey.\n"
        "Seed = single · package = multi.",
    ),
    "12c Restore nsec": (
        "12c Restore · nsec tab",
        "Same caption as 12b.\nnsec + passphrase → multi-wallet package.",
    ),
    "12h Restore home server": (
        "12h Restore · Server tab",
        "Same caption as 12b.\nURL + token + passphrase.",
    ),
    "14 Add wallet": (
        "14 Add wallet",
        "From Home switcher → + Create.\n"
        "NOT onboarding. Passkey derive OR\nwithout passkey → motion entropy.",
    ),
    "14b Create without passkey": (
        "14b Motion entropy",
        "ONLY for extra wallets without passkey.\n"
        "CSPRNG + gesture. Never first-run.",
    ),
    "14c Name new wallet": (
        "14c Name wallet",
        "Label after PRF or entropy path.",
    ),
    "05 Settings": (
        "05 Settings",
        "Main settings hub.",
    ),
    "05b Display currencies": (
        "05b Currencies",
        "Fiat display preferences.",
    ),
    "05c Privacy": (
        "05c Privacy",
        "Biometrics lock · app PIN · screenshots.",
    ),
    "05d Nostr identity": (
        "05d Nostr identity",
        "Profile: npub · NIP-05 · display name ·\n"
        "Lightning address · about.\n"
        "Export nsec (gated) · Import nsec ·\n"
        "Encrypted backup status.",
    ),
    "05e Backup": (
        "05e Backup",
        "Hub: Passkey · export phrase ·\n"
        "Nostr / home server package · restore.\n"
        "Passphrase loss warning.",
    ),
    "05f About": (
        "05f About",
        "Logo + app caption.\n"
        "Arkade ASP info (arkade.money About).\n"
        "Wallet mode = hd (Basic).\n"
        "Footer: version · license ·\n"
        "GitHub · theDavidCoen/BasicWallet\n"
        "(real link only in app UI).",
    ),
    "05g Duress PIN": (
        "05g Duress PIN",
        "Decoy wallet PIN setup.",
    ),
    "05h Passkey status": (
        "05h Passkey status",
        "Sync status + export phrase.\n"
        "Backup options → 05e.",
    ),
    "11e Export recovery phrase": (
        "11e Export 24 words",
        "SETTINGS ONLY — never onboarding.\n"
        "After passkey/PIN. Offline safety net.",
    ),
    "07 Hardware Wallet": (
        "07 Hardware Wallet",
        "Pair signing device.",
    ),
    "01 Home": (
        "01 Home",
        "Selected wallet balance only.\n"
        "LN is a separate switcher entry.\n"
        "Tap-and-hold empty space → Settings.\n"
        "(Prototype: click empty area.)\n"
        "Tap logo → always Home.",
    ),
    "01b Home privacy": (
        "01b Privacy",
        "Tap balance to hide amounts.\n"
        "Tap-and-hold empty → Settings.\n"
        "Tap logo → Home.",
    ),
    "01c Wallet switcher": (
        "01c Wallet switcher",
        "Tap name → Home + set default.\n"
        "Tap › → Edit wallet.\n"
        "LN tag = BTCPay | NWC | macaroon.\n"
        "Balances separate.",
    ),
    "01j Edit wallet": (
        "01j Edit wallet",
        "Rename + Remove (red).\n"
        "From switcher › on a wallet row.",
    ),
    "01k Remove wallet warning": (
        "01k Remove · seed wallet",
        "Offer Backup recovery phrase first.\n"
        "Remove without backup = red.",
    ),
    "01m Remove Lightning warning": (
        "01m Remove · Lightning",
        "No seed backup.\n"
        "Disconnect node / drop switcher row.\n"
        "Funds stay on the node.",
    ),
    "01d Activity sheet": (
        "01d Activity",
        "Recent txs for selected wallet.\nTap row → Transaction details.",
    ),
    "01h Transaction details": (
        "01h Tx · on-chain / Ark",
        "Notes = last list field (editable).\n"
        "Footer: Sent with model · codename.\n"
        "Txid + explorer. Metadata syncs.",
    ),
    "01i Transaction details LN": (
        "01i Tx · Lightning",
        "Notes = last list field (editable).\n"
        "Footer: Sent with model · codename.\n"
        "Hash + preimage. Metadata syncs.",
    ),
    "01e Lock biometrics": (
        "01e Unlock biometrics",
        "Touch / Face ID preferred.",
    ),
    "01f Lock PIN": (
        "01f Unlock PIN",
        "PIN fallback.",
    ),
    "01g Duress Home": (
        "01g Duress Home",
        "Decoy wallet after duress PIN.",
    ),
    "06 Connect Node": (
        "06 Connect Node",
        "Hub from switcher or Settings.\n"
        "BTCPay · NWC · Manual LND.",
    ),
    "06b Connect BTCPay": (
        "06b BTCPay",
        "URL + pairing / QR.\nTag in switcher = BTCPay.",
    ),
    "06c Connect NWC": (
        "06c NWC",
        "Paste nostr+walletconnect://\nTag in switcher = NWC.",
    ),
    "06d Connect Manual LND": (
        "06d Manual LND",
        "REST endpoint + macaroon (+ TLS).\nTag in switcher = macaroon.",
    ),
    "13 Node Status": (
        "13 Node Status",
        "Connected Lightning details.\nDisconnect removes switcher row.",
    ),
    "02 Receive BIP21": (
        "02 Receive",
        "BIP21 primary. LN option if node linked.",
    ),
    "02d Receive POS": (
        "02d POS",
        "Amount keypad receive.",
    ),
    "02b Receive sheet": (
        "02b Format sheet",
        "Choose address format.",
    ),
    "02c Receive share sheet": (
        "02c Share",
        "Share BIP21 / address.",
    ),
    "03 Send empty": (
        "03 Send empty",
        "Amount + recipient. Scan FAB.\n"
        "Direct on-chain only if LN node,\n"
        "multisig, or seed+HW; else L2 only.",
    ),
    "03b Send ready": (
        "03b Send ready",
        "Slide to confirm.\n"
        "Block bc1 on soft seed (no HW).",
    ),
    "03c Send slide early": (
        "03c Slide early",
        "Early drag on slider.",
    ),
    "04 Swap BTC to USDT": (
        "04 Swap",
        "BTC → USDT when seed wallet selected.\n"
        "If selected = Lightning node: Taproot Assets\n"
        "only when node supports TA; else hide Swap.",
    ),
    "08 Contacts": (
        "08 Contacts",
        "Private directory.",
    ),
    "08d Contacts search": (
        "08d Search",
        "Filter contacts.",
    ),
    "08b Choose Recipient": (
        "08b Recipient",
        "Paste or pick contact.",
    ),
    "08c Edit contact": (
        "08c Edit contact",
        "Name · type · identifier.",
    ),
    "09 Nostr inbox": (
        "09 Nostr inbox",
        "Gift-wrapped payment requests.",
    ),
    "09b Compose request": (
        "09b Compose",
        "Contact → amount → send.",
    ),
    "09c Incoming pay": (
        "09c Incoming",
        "Accept & share address.",
    ),
    "09d Outgoing pending": (
        "09d Pending",
        "Waiting for accept.",
    ),
    "09e Accepted address": (
        "09e Accepted",
        "Continue to Send.",
    ),
    "09f Declined / expired": (
        "09f Closed",
        "Rejected / expired / cancelled.",
    ),
    "10 Multisig": (
        "10 Multisig",
        "Vault hub · invite / import.",
    ),
    "10b Multisig invite": (
        "10b Invite",
        "Share invite with cosigner.",
    ),
    "10c Multisig pending": (
        "10c Pending",
        "Signatures in progress.",
    ),
    "10d Multisig cosign": (
        "10d Cosign",
        "Review and slide to sign.",
    ),
    "11d Ready": (
        "11d Ready",
        "No CTA.\nAuto → Home after ~2s\n(prototype after-delay).",
    ),
    "03d Send slide mid": (
        "03d Slide mid",
        "Nearly complete drag.\nRelease → success.",
    ),
    "03e Send success": (
        "03e Send success",
        "Broadcast confirmation.\nView tx → 01h.",
    ),
    "03f Scan QR": (
        "03f Scan QR",
        "Shared scanner for Send /\nConnect / invites.",
    ),
    "04b Swap success": (
        "04b Swap success",
        "Swap complete → Done → Home.",
    ),
    "05i Export nsec warning": (
        "05i Export nsec gate",
        "From 05d Export nsec.\nThen reveal screen.",
    ),
    "05j Export nsec reveal": (
        "05j Export nsec reveal",
        "Show nsec once.\nScreenshots blocked.",
    ),
    "05k Generate identity warning": (
        "05k New identity",
        "From 05d Generate new.\nRe-wrap backup after.",
    ),
    "08e Add contact": (
        "08e Add contact",
        "Empty form from + Add.",
    ),
    "10e Create vault": (
        "10e Create vault",
        "In-app keys only.\nThen invite cosigners.",
    ),
    "10f Import descriptor": (
        "10f Import descriptor",
        "Recovery BSMS / descriptor.",
    ),
    "07b Pair hardware": (
        "07b Pair hardware",
        "From Hardware hub.",
    ),
    "07c Confirm on device": (
        "07c Confirm on device",
        "Handoff from Send / Multisig\nwhen HW paired.",
    ),
}


def note_height(body: str) -> int:
    lines = body.count("\n") + 1
    return max(120, 48 + lines * 18)


def make_note(name, title, body, x, y):
    h = note_height(body)
    fid = rb.uid()
    fr = rb.shape("frame", f"note · {name}", x, y, NOTE_W, h, ROOT, fid)
    fr["id"] = fid
    fr["frame-id"] = fid
    fr["fills"] = [{"fill-color": "#FFE566", "fill-opacity": 1}]
    fr["strokes"] = []
    fr["r1"] = fr["r2"] = fr["r3"] = fr["r4"] = 8
    fr["shapes"] = []
    fr["show-content"] = True
    kids = [
        rb.make_text("nt", x + 12, y + 12, NOTE_W - 24, 28, fid, fid, title, size=13, weight="700", color="#000000"),
        rb.make_text("nb", x + 12, y + 44, NOTE_W - 24, h - 56, fid, fid, body, size=11, color="#222222"),
    ]
    return fr, kids


def finish(changes, fr, kids, page_id):
    changes.append(
        {"type": "add-obj", "id": fr["id"], "page-id": page_id, "frame-id": ROOT, "parent-id": ROOT, "obj": fr}
    )
    for k in kids:
        k["frame-id"] = fr["id"]
        k["parent-id"] = fr["id"]
        changes.append(
            {"type": "add-obj", "id": k["id"], "page-id": page_id, "frame-id": fr["id"], "parent-id": fr["id"], "obj": k}
        )


def layout_for(board_names):
    rows = []
    for i in range(0, len(board_names), 3):
        rows.append((BOARD_Y + (i // 3) * 1004, board_names[i : i + 3]))
    return rows


def ensure_page(c, revn, vern, pages, name):
    if name in pages:
        return pages, revn, vern, pages[name]
    pid = str(uuid.uuid4())
    st, out = c.update(revn, vern, [{"type": "add-page", "id": pid, "name": name}])
    if st != 200:
        raise SystemExit(f"add-page failed: {out}")
    revn, vern = int(out["revn"]), int(out.get("vern", vern))
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}
    print(f"created page {name} -> {pages[name]}")
    return pages, revn, vern, pages[name]


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    targets = [only] if only else list(REBUILD_PAGES)

    c = rb.Client()
    c.login()
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    pages = {meta["data"]["pagesIndex"][pid]["name"]: pid for pid in meta["data"]["pages"]}

    for page_name in targets:
        board_names = REBUILD_PAGES[page_name]
        pages, revn, vern, page_id = ensure_page(c, revn, vern, pages, page_name)
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={page_id}")["objects"]
        wipe = [
            {"type": "del-obj", "id": oid, "page-id": page_id}
            for oid, o in objs.items()
            if oid != ROOT and o.get("name") != "Root Frame"
        ]
        print(f"wipe {page_name}: {len(wipe)}")
        if wipe:
            revn, vern = rb.push(c, revn, vern, wipe, chunk=80)

        changes = []
        for row_y, names in layout_for(board_names):
            for col_i, bname in enumerate(names):
                bx = ORIGIN_X + col_i * COL
                by = row_y
                if bname not in rb.BUILDERS:
                    raise SystemExit(f"missing builder: {bname}")
                fr, kids = rb.BUILDERS[bname](bx, by)
                finish(changes, fr, kids, page_id)
                print(f"  + {bname}")
                if bname in NOTES:
                    title, body = NOTES[bname]
                    nfr, nkids = make_note(bname, title, body, bx + PHONE_W + NOTE_SIDE_GAP, by)
                    finish(changes, nfr, nkids, page_id)
                else:
                    print(f"  ! missing note for {bname}")
        for i in range(0, len(changes), 40):
            part = changes[i : i + 40]
            st, out = c.update(revn, vern, part)
            if st != 200:
                raise SystemExit(f"update fail: {out}")
            revn, vern = int(out["revn"]), int(out.get("vern", vern))
            print(f"  chunk {i}+{len(part)} -> revn {revn}")
        print(f"push {page_name} {len(changes)}")

    print(f"DONE revn {revn}")


if __name__ == "__main__":
    main()
