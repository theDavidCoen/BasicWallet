#!/usr/bin/env python3
"""Apply new Penpot comments, add scenes, reply on each thread."""
from __future__ import annotations

import json
import math
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path
import importlib.util

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
PAGE = "0d808482-264d-8195-8008-a46d9fbf8811"
ROOT = "00000000-0000-0000-0000-000000000000"
BASE = "http://192.168.1.104:9001"
ENV = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
EMAIL = re.search(r"PENPOT_EMAIL=(.*)", ENV).group(1).strip()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", ENV).group(1).strip()

_spec = importlib.util.spec_from_file_location("vl", Path(__file__).with_name("penpot_vector_logo.py"))
_vl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vl)

TITLE_SIZE = 20
TITLE_Y_OFF = 100  # relative to frame y


def uid():
    return str(uuid.uuid4())


def matrix():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def selrect(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def points(x, y, w, h):
    return [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]


def geom(o, x, y, w, h):
    o.update(
        {
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "selrect": selrect(x, y, w, h),
            "points": points(x, y, w, h),
            "transform": matrix(),
            "transform-inverse": matrix(),
            "rotation": 0,
            "opacity": 1,
        }
    )
    return o


def shape(typ, name, x, y, w, h, parent, frame):
    return geom(
        {
            "id": uid(),
            "name": name,
            "type": typ,
            "parent-id": parent,
            "frame-id": frame,
            "fills": [],
            "strokes": [],
        },
        x,
        y,
        w,
        h,
    )


def make_frame(name, x, y, w=390, h=844):
    fid = uid()
    o = shape("frame", name, x, y, w, h, ROOT, fid)
    o["id"] = o["frame-id"] = fid
    o["fills"] = [{"fill-color": "#000000", "fill-opacity": 1}]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = 28
    o["shapes"] = []
    o["show-content"] = True
    o["hide-fill-on-export"] = False
    return o


def make_rect(name, x, y, w, h, parent, frame, *, fill=None, stroke="#FFFFFF", sw=1.5, rx=8, opacity=1):
    o = shape("rect", name, x, y, w, h, parent, frame)
    if fill:
        o["fills"] = [{"fill-color": fill, "fill-opacity": 1}]
    if stroke:
        o["strokes"] = [
            {
                "stroke-color": stroke,
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": sw,
                "stroke-alignment": "inner",
            }
        ]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = rx
    o["opacity"] = opacity
    return o


def make_text(name, x, y, w, h, parent, frame, text, *, size=14, color="#FFFFFF", weight="400", align="left"):
    o = shape("text", name, x, y, w, h, parent, frame)
    o["grow-type"] = "fixed"
    o["content"] = {
        "type": "root",
        "vertical-align": "top",
        "children": [
            {
                "type": "paragraph-set",
                "children": [
                    {
                        "type": "paragraph",
                        "text-align": align,
                        "children": [
                            {
                                "line-height": "1.25",
                                "font-style": "normal",
                                "text-align": align,
                                "font-size": str(size),
                                "font-weight": str(weight),
                                "font-family": "JetBrains Mono",
                                "font-id": "gfont-jetbrains-mono",
                                "font-variant": "normal",
                                "text-decoration": "none",
                                "text-transform": "none",
                                "fills": [{"fill-color": color, "fill-opacity": 1}],
                                "text": text,
                            }
                        ],
                    }
                ],
            }
        ],
    }
    return o


def make_path(name, parent, frame, cmds, *, stroke="#FFFFFF", sw=1.6, fill=None):
    xs, ys = [], []
    for c in cmds:
        for k, v in (c.get("params") or {}).items():
            if k.endswith("x") or k == "x":
                xs.append(v)
            elif k.endswith("y") or k == "y":
                ys.append(v)
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    pad = sw + 1
    o = shape("path", name, x0 - pad, y0 - pad, (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad, parent, frame)
    o["content"] = cmds
    o["fills"] = [{"fill-color": fill, "fill-opacity": 1}] if fill else []
    if stroke:
        o["strokes"] = [
            {
                "stroke-color": stroke,
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": sw,
                "stroke-alignment": "center",
            }
        ]
    return o


def line(x1, y1, x2, y2):
    return [
        {"command": "move-to", "params": {"x": x1, "y": y1}},
        {"command": "line-to", "params": {"x": x2, "y": y2}},
    ]


def circle_approx(cx, cy, r, n=24):
    cmds = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        cmds.append({"command": "move-to" if i == 0 else "line-to", "params": {"x": x, "y": y}})
    cmds.append({"command": "close-path", "params": {}})
    return cmds


def camera_lens(cx, cy, parent, frame):
    """Photographic lens / objective icon."""
    cmds = []
    cmds += circle_approx(cx, cy, 28, 28)
    cmds += circle_approx(cx, cy, 20, 24)
    cmds += circle_approx(cx, cy, 10, 20)
    # small highlight arc
    cmds += line(cx - 6, cy - 14, cx + 2, cy - 18)
    return make_path("scan-lens", parent, frame, cmds, sw=1.7)


def icon_copy(cx, cy, parent, frame):
    cmds = []
    # back rect
    cmds += line(cx - 6, cy - 4, cx + 4, cy - 4)
    cmds += line(cx + 4, cy - 4, cx + 4, cy + 8)
    cmds += line(cx + 4, cy + 8, cx - 6, cy + 8)
    cmds += line(cx - 6, cy + 8, cx - 6, cy - 4)
    # front rect offset
    cmds += line(cx - 2, cy - 8, cx + 8, cy - 8)
    cmds += line(cx + 8, cy - 8, cx + 8, cy + 4)
    cmds += line(cx + 8, cy + 4, cx + 4, cy + 4)
    cmds += line(cx - 2, cy - 8, cx - 2, cy - 4)
    return make_path("ico-copy", parent, frame, cmds, sw=1.5)


def icon_share(cx, cy, parent, frame):
    cmds = []
    # three nodes + lines
    nodes = [(cx, cy - 8), (cx - 8, cy + 6), (cx + 8, cy + 6)]
    for x, y in nodes:
        cmds += circle_approx(x, y, 2.5, 10)
    cmds += line(nodes[0][0], nodes[0][1], nodes[1][0], nodes[1][1])
    cmds += line(nodes[0][0], nodes[0][1], nodes[2][0], nodes[2][1])
    return make_path("ico-share", parent, frame, cmds, sw=1.5)


def swap_arrows(cx, cy, parent, frame):
    cmds = []
    cmds += line(cx - 5, cy + 8, cx - 5, cy - 8)
    cmds += line(cx - 5, cy - 8, cx - 8, cy - 4)
    cmds += line(cx - 5, cy - 8, cx - 2, cy - 4)
    cmds += line(cx + 5, cy - 8, cx + 5, cy + 8)
    cmds += line(cx + 5, cy + 8, cx + 2, cy + 4)
    cmds += line(cx + 5, cy + 8, cx + 8, cy + 4)
    return make_path("swap-ico", parent, frame, cmds, sw=1.6)


def elastic_slider(ox, oy, parent, frame, *, progress=0.58, label="slide to confirm"):
    """Centered label; black when elastic covers center, else white."""
    kids = []
    tw, th = 334, 52
    kids.append(make_rect("slider", ox, oy, tw, th, parent, frame, stroke="#FFFFFF", rx=10))
    fill_w = max(48, int(tw * progress))
    kids.append(
        make_rect("slider-elastic", ox + 4, oy + 4, fill_w - 8, th - 8, parent, frame, fill="#FFFFFF", stroke=None, rx=8)
    )
    tip_x = ox + fill_w - 36
    kids.append(
        make_text("handle-gt", tip_x, oy + 12, 32, 28, parent, frame, ">", size=18, color="#000000", weight="700", align="center")
    )
    # label always centered on full track
    label_color = "#000000" if fill_w >= tw * 0.45 else "#FFFFFF"
    kids.append(
        make_text("slide", ox, oy + 16, tw, 24, parent, frame, label, size=13, color=label_color, align="center")
    )
    return kids


def title(fid, ox, oy, text):
    return make_text("title", ox + 40, oy + TITLE_Y_OFF, 310, 28, fid, fid, text, size=TITLE_SIZE, weight="700", align="center")


def logo(ox, oy, parent, frame, scale=0.77):
    return _vl.make_logo_group(ox, oy, parent, frame, scale=scale)


def rates_footer(ox, oy, parent, frame):
    return make_text(
        "rates",
        ox + 20,
        oy + 790,
        350,
        20,
        parent,
        frame,
        "BTC/USD 64,920   ·   BTC/EUR 60,190",
        size=11,
        color="#8C8C8C",
        align="center",
    )


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
        with self.opener.open(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode()) if raw else None)

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

    def reply(self, thread_id, content):
        content = content[:740]
        return self.post("/api/rpc/command/create-comment", {"thread-id": thread_id, "content": content})

    def resolve(self, thread_id, resolved=True):
        return self.post(
            "/api/rpc/command/update-comment-thread-status",
            {"id": thread_id, "is-resolved": resolved},
        )


def add(changes, obj, parent, frame):
    changes.append(
        {"type": "add-obj", "id": obj["id"], "page-id": PAGE, "frame-id": frame, "parent-id": parent, "obj": obj}
    )


def push(c, revn, vern, changes, chunk=70):
    for i in range(0, len(changes), chunk):
        part = changes[i : i + chunk]
        st, out = c.update(revn, vern, part)
        if st != 200:
            print("FAIL", out)
            raise SystemExit(1)
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
        print(f"  pushed {i}-{i+len(part)} -> revn {revn}")
    return revn, vern


def main():
    c = Client()
    c.login()
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    threads = {t["seqn"]: t for t in c.get(f"/api/rpc/command/get-comment-threads?file-id={FILE}")}

    # ---- delete objects to replace ----
    del_names = {
        "title",
        "balance",
        "fiat",
        "btn-receive",
        "label-receive",
        "btn-send",
        "label-send",
        "swap-ico",
        "copy",
        "scan",
        "scan-reticle",
        "scan-lens",
        "slider",
        "slider-elastic",
        "handle",
        "handle-gt",
        "slide",
        "micro",
        "avatar",
        "avatar-ring",
        "ico-copy",
        "ico-share",
        "actions-row",
    }
    # also delete titles on several screens for realignment
    target_frames = {
        "01 Home",
        "01b Home privacy",
        "03 Send empty",
        "03b Send ready",
        "04 Swap BTC to USDT",
        "02 Receive BIP21",
        "06 Connect Node",
        "05 Settings",
        "07 Hardware Wallet",
        "08 Contacts",
        "09 Nostr Payment Request",
        "10 Multisig",
        "11 Onboarding Create",
        "12 Advanced Backup",
        "13 Node Status",
        "02b Receive sheet",
    }
    to_del = []
    for oid, o in objs.items():
        name = o.get("name") or ""
        parent = objs.get(o.get("parentId") or "", {}).get("name")
        if parent in target_frames and name in del_names:
            to_del.append(oid)
        if o.get("type") == "frame" and name in (
            "01c Wallet switcher",
            "02c Receive share sheet",
            "08b Choose Recipient",
            "08c Edit contact",
            "08d Contacts search",
            "10b Multisig invite",
            "10c Multisig pending",
            "10d Multisig cosign",
        ):
            to_del.append(oid)
            for cid, ch in objs.items():
                if ch.get("parentId") == oid:
                    to_del.append(cid)

    if to_del:
        st, out = c.update(revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in sorted(set(to_del))])
        print("deleted", len(set(to_del)), "revn", out.get("revn"))
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
        frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}

    changes = []

    # ===== #10 + #17 Home buttons + avatar =====
    for fr_name, privacy in (("01 Home", False), ("01b Home privacy", True)):
        fr = frames[fr_name]
        ox, oy, fid = fr["x"], fr["y"], fr["id"]
        # avatar upper left
        add(changes, make_rect("avatar-ring", ox + 24, oy + 56, 40, 40, fid, fid, fill="#2A2A2A", stroke="#FFFFFF", rx=20), fid, fid)
        add(changes, make_text("avatar", ox + 24, oy + 66, 40, 24, fid, fid, "DC", size=12, weight="700", align="center"), fid, fid)
        # balance
        if privacy:
            add(changes, make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "****** sats", size=28, weight="700", align="center"), fid, fid)
            add(changes, make_text("fiat", ox + 40, oy + 292, 310, 24, fid, fid, "tap to show", size=13, color="#8C8C8C", align="center"), fid, fid)
        else:
            add(changes, make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "1,234,567 sats", size=28, weight="700", align="center"), fid, fid)
            add(changes, make_text("fiat", ox + 40, oy + 292, 310, 24, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center"), fid, fid)
        # larger aligned buttons
        add(changes, make_rect("btn-receive", ox + 36, oy + 360, 140, 56, fid, fid, rx=10), fid, fid)
        add(changes, make_text("label-receive", ox + 36, oy + 376, 140, 24, fid, fid, "Receive", size=16, align="center"), fid, fid)
        add(changes, swap_arrows(ox + 195, oy + 388, fid, fid), fid, fid)
        add(changes, make_rect("btn-send", ox + 214, oy + 360, 140, 56, fid, fid, rx=10), fid, fid)
        add(changes, make_text("label-send", ox + 214, oy + 376, 140, 24, fid, fid, "Send", size=16, align="center"), fid, fid)

    # ===== #9 Send empty/ready: title aligned, balance below =====
    for fr_name, ready in (("03 Send empty", False), ("03b Send ready", True)):
        fr = frames[fr_name]
        ox, oy, fid = fr["x"], fr["y"], fr["id"]
        add(changes, title(fid, ox, oy, "SEND"), fid, fid)
        add(changes, make_text("balance", ox + 40, oy + 145, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center"), fid, fid)
        add(changes, make_text("fiat", ox + 40, oy + 182, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center"), fid, fid)
        if not ready:
            # #8 camera lens
            add(changes, camera_lens(ox + 195, oy + 660, fid, fid), fid, fid)
            add(changes, make_text("scan", ox + 40, oy + 710, 310, 18, fid, fid, "scan QR", size=12, color="#8C8C8C", align="center"), fid, fid)
        else:
            # #4 #13 elastic + centered label color flip
            for k in elastic_slider(ox + 28, oy + 540, fid, fid, progress=0.58):
                add(changes, k, fid, fid)
            add(
                changes,
                make_text(
                    "micro",
                    ox + 28,
                    oy + 605,
                    334,
                    16,
                    fid,
                    fid,
                    "label centered · turns black under white elastic",
                    size=10,
                    color="#474747",
                    align="center",
                ),
                fid,
                fid,
            )

    # ===== #11 Receive: copy + share icons =====
    fr = frames["02 Receive BIP21"]
    ox, oy, fid = fr["x"], fr["y"], fr["id"]
    # ensure title aligned
    add(changes, title(fid, ox, oy, "RECEIVE BTC"), fid, fid)
    add(changes, icon_copy(ox + 150, oy + 500, fid, fid), fid, fid)
    add(changes, icon_share(ox + 240, oy + 500, fid, fid), fid, fid)

    # ===== #12 Swap elastic slide =====
    fr = frames["04 Swap BTC to USDT"]
    ox, oy, fid = fr["x"], fr["y"], fr["id"]
    add(changes, title(fid, ox, oy, "SWAP"), fid, fid)
    for k in elastic_slider(ox + 28, oy + 470, fid, fid, progress=0.35, label="slide to confirm"):
        add(changes, k, fid, fid)

    # Realign a few other titles for consistency
    for name, label in (
        ("06 Connect Node", "CONNECT NODE"),
        ("05 Settings", "SETTINGS"),
        ("07 Hardware Wallet", "HARDWARE"),
        ("08 Contacts", "CONTACTS"),
        ("09 Nostr Payment Request", "NOSTR REQUEST"),
        ("10 Multisig", "MULTISIG"),
        ("12 Advanced Backup", "ADVANCED BACKUP"),
        ("13 Node Status", "NODE STATUS"),
        ("02b Receive sheet", "RECEIVE BTC"),
    ):
        if name in frames:
            fr = frames[name]
            add(changes, title(fr["id"], fr["x"], fr["y"], label), fr["id"], fr["id"])

    # ===== #16 Onboarding restore link =====
    if "11 Onboarding Create" in frames:
        fr = frames["11 Onboarding Create"]
        ox, oy, fid = fr["x"], fr["y"], fr["id"]
        add(
            changes,
            make_text(
                "restore",
                ox + 28,
                oy + 780,
                334,
                24,
                fid,
                fid,
                "Already have a wallet? Restore",
                size=13,
                color="#8C8C8C",
                align="center",
            ),
            fid,
            fid,
        )

    # ===== New screens =====
    def finish_frame(fr, kids):
        fr["shapes"] = [k["id"] for k in kids]
        add(changes, fr, ROOT, fr["id"])
        for k in kids:
            add(changes, k, fr["id"], fr["id"])

    # #17 wallet switcher sheet
    fr = make_frame("01c Wallet switcher", 450, 3100)
    fid, ox, oy = fr["id"], fr["x"], fr["y"]
    kids = []
    kids += logo(ox + 145, oy + 70, fid, fid, 1.0)
    kids.append(make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "1,234,567 sats", size=28, weight="700", align="center"))
    kids.append(make_rect("dim", ox, oy + 180, 390, 664, fid, fid, fill="#000000", stroke=None, rx=0, opacity=0.55))
    sh = 380
    kids.append(make_rect("sheet", ox, oy + 844 - sh, 390, sh, fid, fid, fill="#1C1C1E", stroke=None, rx=0))
    kids[-1]["r1"] = kids[-1]["r2"] = 16
    kids[-1]["r3"] = kids[-1]["r4"] = 0
    kids.append(make_rect("grabber", ox + 165, oy + 844 - sh + 10, 60, 5, fid, fid, fill="#636366", stroke=None, rx=3))
    kids.append(make_text("st", ox + 24, oy + 844 - sh + 28, 340, 22, fid, fid, "Wallets", size=17, weight="700", align="center"))
    # wallet card
    yy = oy + 844 - sh + 70
    kids.append(make_rect("card", ox + 16, yy, 358, 72, fid, fid, fill="#2C2C2E", stroke=None, rx=12))
    kids.append(make_rect("av", ox + 28, yy + 16, 40, 40, fid, fid, fill="#3A3A3C", stroke="#FFFFFF", rx=20))
    kids.append(make_text("avt", ox + 28, yy + 26, 40, 22, fid, fid, "DC", size=11, weight="700", align="center"))
    kids.append(make_text("wn", ox + 80, yy + 18, 200, 22, fid, fid, "Personal", size=15, weight="700"))
    kids.append(make_text("np", ox + 80, yy + 42, 220, 18, fid, fid, "npub1david…", size=11, color="#8C8C8C"))
    kids.append(make_text("edit", ox + 300, yy + 26, 60, 22, fid, fid, "Edit", size=13, color="#8C8C8C", align="right"))
    kids.append(make_rect("add", ox + 16, yy + 90, 358, 48, fid, fid, fill="#2C2C2E", stroke=None, rx=12))
    kids.append(make_text("addl", ox + 16, yy + 104, 358, 24, fid, fid, "+ Add wallet", size=15, align="center"))
    finish_frame(fr, kids)

    # #11 share sheet
    fr = make_frame("02c Receive share sheet", 900, 3100)
    fid, ox, oy = fr["id"], fr["x"], fr["y"]
    kids = []
    kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
    kids.append(title(fid, ox, oy, "RECEIVE BTC"))
    kids.append(make_rect("dim", ox, oy + 200, 390, 644, fid, fid, fill="#000000", stroke=None, rx=0, opacity=0.55))
    sh = 280
    kids.append(make_rect("sheet", ox, oy + 844 - sh, 390, sh, fid, fid, fill="#1C1C1E", stroke=None, rx=0))
    kids[-1]["r1"] = kids[-1]["r2"] = 16
    kids.append(make_rect("grabber", ox + 165, oy + 844 - sh + 10, 60, 5, fid, fid, fill="#636366", stroke=None, rx=3))
    kids.append(make_text("st", ox + 24, oy + 844 - sh + 28, 340, 22, fid, fid, "Share", size=17, weight="700", align="center"))
    for i, lab in enumerate(["Share BIP21 URL", "Share address only", "Share QR image"]):
        yy = oy + 844 - sh + 70 + i * 52
        kids.append(make_rect(f"row-{i}", ox + 16, yy, 358, 44, fid, fid, fill="#2C2C2E", stroke=None, rx=10))
        kids.append(make_text(f"opt-{i}", ox + 32, yy + 12, 300, 22, fid, fid, lab, size=14))
    finish_frame(fr, kids)

    # #15 Contacts scenes
    def choose_recipient(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(title(fid, ox, oy, "CHOOSE RECIPIENT"))
        kids.append(make_rect("search", ox + 28, oy + 150, 334, 44, fid, fid, rx=10))
        kids.append(make_text("sph", ox + 42, oy + 162, 300, 22, fid, fid, "Search name or identifier", size=13, color="#595959"))
        for i, (n, idn) in enumerate([("Alice", "npub1alice…"), ("Bob", "bc1q…"), ("Cafe", "lnurl1…")]):
            yy = oy + 220 + i * 72
            kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 60, fid, fid))
            kids.append(make_rect(f"av-{i}", ox + 40, yy + 12, 36, 36, fid, fid, fill="#2A2A2A", stroke="#FFFFFF", rx=18))
            kids.append(make_text(f"ini-{i}", ox + 40, yy + 20, 36, 20, fid, fid, n[0], size=12, align="center"))
            kids.append(make_text(f"n-{i}", ox + 88, yy + 12, 240, 22, fid, fid, n, size=15, weight="700"))
            kids.append(make_text(f"id-{i}", ox + 88, yy + 34, 250, 18, fid, fid, idn, size=11, color="#8C8C8C"))
        kids.append(make_rect("add", ox + 28, oy + 460, 334, 48, fid, fid))
        kids.append(make_text("addl", ox + 28, oy + 474, 334, 24, fid, fid, "+ Add contact", size=15, align="center"))
        kids.append(
            make_text(
                "priv",
                ox + 28,
                oy + 760,
                334,
                40,
                fid,
                fid,
                "Saved privately in your encrypted wallet. Never synced to device contacts.",
                size=11,
                color="#8C8C8C",
                align="center",
            )
        )
        return kids

    def edit_contact(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(title(fid, ox, oy, "EDIT CONTACT"))
        kids.append(make_text("ln", ox + 28, oy + 160, 100, 18, fid, fid, "name", size=12, color="#8C8C8C"))
        kids.append(make_rect("fn", ox + 28, oy + 180, 334, 48, fid, fid))
        kids.append(make_text("vn", ox + 42, oy + 194, 300, 24, fid, fid, "Alice", size=14))
        kids.append(make_text("li", ox + 28, oy + 250, 200, 18, fid, fid, "identifiers", size=12, color="#8C8C8C"))
        for i, (typ, val) in enumerate([("npub", "npub1alice…"), ("address", "bc1q…"), ("NIP-05", "alice@nostr.example")]):
            yy = oy + 280 + i * 70
            kids.append(make_rect(f"id-{i}", ox + 28, yy, 334, 56, fid, fid))
            kids.append(make_text(f"t-{i}", ox + 44, yy + 10, 120, 18, fid, fid, typ, size=11, color="#8C8C8C"))
            kids.append(make_text(f"v-{i}", ox + 44, yy + 30, 300, 20, fid, fid, val, size=13))
        kids.append(make_rect("save", ox + 28, oy + 520, 334, 48, fid, fid, fill="#FFFFFF", stroke=None))
        kids.append(make_text("savel", ox + 28, oy + 534, 334, 24, fid, fid, "Save", size=15, color="#000000", weight="700", align="center"))
        kids.append(make_text("del", ox + 28, oy + 590, 334, 24, fid, fid, "Delete contact", size=13, color="#8C8C8C", align="center"))
        return kids

    def contacts_search(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(title(fid, ox, oy, "CONTACTS"))
        kids.append(make_rect("search", ox + 28, oy + 150, 334, 44, fid, fid, rx=10))
        kids.append(make_text("sph", ox + 42, oy + 162, 300, 22, fid, fid, "Search Contacts", size=13, color="#595959"))
        for i, n in enumerate(["Alice", "Bob", "Cafe", "Dan"]):
            yy = oy + 220 + i * 64
            kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 52, fid, fid))
            kids.append(make_text(f"n-{i}", ox + 44, yy + 14, 280, 24, fid, fid, n, size=15))
        kids.append(
            make_rect("privcard", ox + 28, oy + 700, 334, 70, fid, fid, fill="#111111", stroke="#333333", rx=10)
        )
        kids.append(
            make_text(
                "priv",
                ox + 40,
                oy + 718,
                310,
                40,
                fid,
                fid,
                "Saved privately in your encrypted account and never shared.",
                size=11,
                color="#8C8C8C",
                align="center",
            )
        )
        return kids

    for name, x, y, builder in (
        ("08b Choose Recipient", 1350, 3100, choose_recipient),
        ("08c Edit contact", 1800, 3100, edit_contact),
        ("08d Contacts search", 2250, 3100, contacts_search),
    ):
        fr = make_frame(name, x, y)
        finish_frame(fr, builder(fr["id"], x, y))

    # #14 Multisig scenes from Edge prototype
    def ms_invite(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(title(fid, ox, oy, "CREATE MULTISIG"))
        kids.append(make_text("pol", ox + 28, oy + 150, 334, 22, fid, fid, "Policy 2-of-3 · P2WSH", size=13, color="#8C8C8C", align="center"))
        kids.append(make_text("l1", ox + 28, oy + 200, 200, 18, fid, fid, "invite cosigner", size=12, color="#8C8C8C"))
        kids.append(make_rect("f1", ox + 28, oy + 220, 334, 48, fid, fid))
        kids.append(make_text("v1", ox + 42, oy + 234, 300, 24, fid, fid, "npub or NIP-05", size=14, color="#595959"))
        kids.append(make_text("note", ox + 28, oy + 290, 334, 48, fid, fid, "From-scratch: in-app keys only.\nNo pasted xpubs at creation.", size=12, color="#8C8C8C", align="center"))
        kids.append(make_rect("btn", ox + 28, oy + 370, 334, 48, fid, fid, fill="#FFFFFF", stroke=None))
        kids.append(make_text("bl", ox + 28, oy + 384, 334, 24, fid, fid, "Send invite (Nostr)", size=15, color="#000000", weight="700", align="center"))
        kids.append(make_rect("btn2", ox + 28, oy + 435, 334, 48, fid, fid))
        kids.append(make_text("b2", ox + 28, oy + 449, 334, 24, fid, fid, "Import descriptor / BSMS", size=14, align="center"))
        return kids

    def ms_pending(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(title(fid, ox, oy, "MULTISIG PENDING"))
        kids.append(make_text("sub", ox + 28, oy + 150, 334, 36, fid, fid, "Waiting for cosigners · Nostr DMs", size=12, color="#8C8C8C", align="center"))
        for i, (who, st) in enumerate([("You", "ready"), ("Alice", "accepted"), ("Bob", "pending")]):
            yy = oy + 220 + i * 72
            kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 60, fid, fid))
            kids.append(make_text(f"w-{i}", ox + 44, yy + 12, 200, 22, fid, fid, who, size=15, weight="700"))
            kids.append(make_text(f"s-{i}", ox + 44, yy + 34, 280, 18, fid, fid, st, size=12, color="#8C8C8C"))
        kids.append(make_text("flow", ox + 28, oy + 460, 334, 40, fid, fid, "invite → accept → keys exchanged\n→ P2WSH ready", size=12, color="#8C8C8C", align="center"))
        return kids

    def ms_cosign(fid, ox, oy):
        kids = []
        kids += logo(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(title(fid, ox, oy, "COSIGN SPEND"))
        kids.append(make_text("amt", ox + 40, oy + 160, 310, 28, fid, fid, "25,000 sats", size=22, weight="700", align="center"))
        kids.append(make_text("to", ox + 40, oy + 200, 310, 22, fid, fid, "to bc1q…", size=13, color="#8C8C8C", align="center"))
        kids.append(make_rect("card", ox + 28, oy + 250, 334, 120, fid, fid))
        kids.append(make_text("psbt", ox + 44, oy + 270, 300, 20, fid, fid, "PSBT via Nostr gift-wrap", size=13, color="#8C8C8C"))
        kids.append(make_text("sig", ox + 44, oy + 300, 300, 20, fid, fid, "Signatures: 1 / 2", size=14, weight="700"))
        kids.append(make_text("wait", ox + 44, oy + 330, 300, 20, fid, fid, "Waiting on Alice…", size=12, color="#8C8C8C"))
        for k in elastic_slider(ox + 28, oy + 420, fid, fid, progress=0.2, label="slide to cosign"):
            kids.append(k)
        return kids

    for name, x, y, builder in (
        ("10b Multisig invite", 2700, 3100, ms_invite),
        ("10c Multisig pending", 0, 4100, ms_pending),
        ("10d Multisig cosign", 450, 4100, ms_cosign),
    ):
        fr = make_frame(name, x, y)
        finish_frame(fr, builder(fr["id"], x, y))

    print("applying shape changes…")
    revn, vern = push(c, revn, vern, changes)

    # ===== Replies on all threads =====
    replies = {
        1: "Fatto: sostituita la 'v' con icona vettoriale a doppie frecce (swap) su Home e Home privacy.",
        2: "Fatto: 02 Receive = prima del tap; 02b Receive sheet = bottom sheet iOS dopo Copy (grabber + lista opzioni indirizzo).",
        3: "Fatto: aggiunta grafica scan. Poi raffinata come obiettivo fotografico (vedi anche #8).",
        4: "Fatto: slider come elastico bianco che si allunga con il dito; freccia '>' sulla punta dell'elastico (come la tua modifica).",
        5: "Fatto: footer rate BTC/USD e BTC/EUR su Home (configurabili da Settings → Display currencies).",
        6: "Fatto: stessi rate anche su Home privacy.",
        7: "Fatto: QR di esempio vettoriale (moduli + finder squares) su Receive.",
        8: "Fatto: icona obiettivo fotografico (lenti concentriche) al posto del mirino generico su Send empty.",
        9: "Fatto: titolo SEND allineato agli altri (y=100, JetBrains Mono 20 Bold). Balance e fiat spostati sotto il titolo. Stesso trattamento titoli sulle altre board.",
        10: "Fatto: Receive/Send più grandi (140×56), allineati, con swap al centro.",
        11: "Fatto: icone copy + share al posto del testo 'Copy address'. Nuova board 02c Receive share sheet (bottom sheet Share).",
        12: "Fatto: aggiunto slide to confirm (elastico) su Swap.",
        13: "Fatto: 'slide to confirm' sempre centrato sul track. Con elastico oltre ~45% la scritta diventa nera; sotto resta bianca.",
        14: "Fatto: scene multisig extra da edge-bitcoin-multisig — 10b Create/invite (npub/NIP-05, no xpub), 10c Pending cosigners, 10d Cosign spend (PSBT/Nostr).",
        15: "Fatto: scene contacts da gist Edge — 08b Choose Recipient (+ privacy), 08c Edit contact (multi-id), 08d Contacts search + privacy card.",
        16: "Fatto: in fondo a Onboarding — 'Already have a wallet? Restore'.",
        17: "Fatto: avatar circolare in alto a sinistra su Home. Nuova board 01c Wallet switcher = bottom sheet con card (avatar, nome, npub, Edit) e '+ Add wallet'.",
    }

    print("replying to threads…")
    for seqn, text in replies.items():
        t = threads.get(seqn)
        if not t:
            print(" missing thread", seqn)
            continue
        # skip if we already replied with same prefix
        st, comments = c.post("/api/rpc/command/get-comments", {"thread-id": t["id"]})
        already = any((c.get("content") or "").startswith("Fatto:") for c in (comments or []))
        if already:
            print(f"  #{seqn} already has Fatto: reply, skip")
        else:
            st, out = c.reply(t["id"], text)
            print(f"  #{seqn} reply {st}")
        st2, _ = c.resolve(t["id"], True)
        print(f"  #{seqn} resolved {st2}")

    print("OK")


if __name__ == "__main__":
    main()
