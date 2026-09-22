#!/usr/bin/env python3
"""Organize Penpot boards into a clean flow grid; fix comments #19–21; reply."""
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

PHONE_W, PHONE_H = 390, 844
GAP_X, GAP_Y = 70, 160
COL = PHONE_W + GAP_X  # 460
ROW = PHONE_H + GAP_Y  # 1004
ORIGIN_X, ORIGIN_Y = 40, 160

# Ordered layout: (section_title, [frame names…])
LAYOUT = [
    ("00 · Onboarding", ["11 Onboarding Create", "12 Advanced Backup"]),
    ("01 · Home", ["01 Home", "01b Home privacy", "01c Wallet switcher", "01d Activity sheet"]),
    ("02 · Receive", ["02 Receive BIP21", "02b Receive sheet", "02c Receive share sheet"]),
    ("03 · Send", ["03 Send empty", "03b Send ready", "03c Send slide early"]),
    ("04 · Swap", ["04 Swap BTC to USDT"]),
    ("05 · Node", ["06 Connect Node", "13 Node Status"]),
    ("06 · Settings", ["05 Settings", "05b Display currencies", "07 Hardware Wallet"]),
    ("07 · Contacts", ["08 Contacts", "08d Contacts search", "08b Choose Recipient", "08c Edit contact"]),
    ("08 · Nostr", ["09 Nostr Payment Request"]),
    ("09 · Multisig", ["10 Multisig", "10b Multisig invite", "10c Multisig pending", "10d Multisig cosign"]),
]


def uid():
    return str(uuid.uuid4())


def matrix(e=0, f=0):
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": e, "f": f}


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
            "opacity": o.get("opacity", 1),
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


def make_frame(name, x, y):
    fid = uid()
    o = shape("frame", name, x, y, PHONE_W, PHONE_H, ROOT, fid)
    o["id"] = o["frame-id"] = fid
    o["fills"] = [{"fill-color": "#000000", "fill-opacity": 1}]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = 28
    o["shapes"] = []
    o["show-content"] = True
    o["hide-fill-on-export"] = False
    return o


def make_rect(name, x, y, w, h, parent, frame, *, fill=None, stroke="#FFFFFF", sw=1.5, rx=8):
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


def make_path(name, parent, frame, cmds, *, stroke="#FFFFFF", sw=1.5, fill=None):
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


def circle(cx, cy, r, n=20):
    cmds = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n - math.pi / 2
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        cmds.append({"command": "move-to" if i == 0 else "line-to", "params": {"x": x, "y": y}})
    cmds.append({"command": "close-path", "params": {}})
    return cmds


def offset_path_content(content, dx, dy):
    if content is None:
        return content
    if isinstance(content, list):
        out = []
        for c in content:
            if c.get("command") == "close-path":
                out.append(c)
                continue
            p = dict(c.get("params") or {})
            for k in list(p):
                if k.endswith("x") or k == "x":
                    p[k] = p[k] + dx
                elif k.endswith("y") or k == "y":
                    p[k] = p[k] + dy
            out.append({"command": c["command"], "params": p})
        return out
    if isinstance(content, str):
        # offset numbers in SVG path roughly: after commands, pairs x,y — fragile but ok for our paths
        # Better: use regex on float tokens with alternating x/y after M/L/C etc. Too hard.
        # Use transform matrix instead for paths with string content.
        return content
    return content


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
        return self.post("/api/rpc/command/create-comment", {"thread-id": thread_id, "content": content[:740]})


def add(changes, obj, parent, frame):
    changes.append(
        {"type": "add-obj", "id": obj["id"], "page-id": PAGE, "frame-id": frame, "parent-id": parent, "obj": obj}
    )


def push(c, revn, vern, changes, chunk=60):
    for i in range(0, len(changes), chunk):
        part = changes[i : i + chunk]
        st, out = c.update(revn, vern, part)
        if st != 200:
            print("FAIL", out)
            raise SystemExit(1)
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
        print(f"  chunk {i}-{i+len(part)} -> {revn}")
    return revn, vern


def descendants(frame_id, objs):
    kids = {frame_id}
    changed = True
    while changed:
        changed = False
        for oid, o in objs.items():
            if o.get("parentId") in kids and oid not in kids:
                kids.add(oid)
                changed = True
    return kids


def move_ops(o, dx, dy):
    """Build mod-obj operations to translate a shape."""
    nx, ny = o["x"] + dx, o["y"] + dy
    ops = [
        {"type": "set", "attr": "x", "val": nx},
        {"type": "set", "attr": "y", "val": ny},
        {"type": "set", "attr": "selrect", "val": selrect(nx, ny, o["width"], o["height"])},
        {"type": "set", "attr": "points", "val": points(nx, ny, o["width"], o["height"])},
    ]
    # path content absolute coords
    content = o.get("content")
    if o.get("type") == "path" and content:
        if isinstance(content, list):
            ops.append({"type": "set", "attr": "content", "val": offset_path_content(content, dx, dy)})
        elif isinstance(content, str):
            # apply translation via transform matrix (keeps d string)
            tr = o.get("transform") or matrix()
            # transform may be camelCase from JSON
            if isinstance(tr, dict):
                e = tr.get("e", tr.get("e", 0)) + dx
                f = tr.get("f", tr.get("f", 0)) + dy
                # keep a b c d
                a, b = tr.get("a", 1), tr.get("b", 0)
                c_, d = tr.get("c", 0), tr.get("d", 1)
                ops.append({"type": "set", "attr": "transform", "val": {"a": a, "b": b, "c": c_, "d": d, "e": e, "f": f}})
                # inverse approx for pure translate
                ops.append(
                    {
                        "type": "set",
                        "attr": "transform-inverse",
                        "val": {"a": 1, "b": 0, "c": 0, "d": 1, "e": -e, "f": -f},
                    }
                )
    # text positionData if present — leave; Penpot regenerates
    return ops


def elastic_slider(ox, oy, parent, frame, *, progress, label="slide to confirm"):
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
    label_color = "#000000" if fill_w >= tw * 0.45 else "#FFFFFF"
    kids.append(make_text("slide", ox, oy + 16, tw, 24, parent, frame, label, size=13, color=label_color, align="center"))
    return kids


def random_avatar(cx, cy, r, parent, frame):
    """Simple geometric 'random' avatar (not initials)."""
    kids = []
    kids.append(make_rect("avatar-ring", cx - r, cy - r, 2 * r, 2 * r, parent, frame, fill="#3D2B1F", stroke="#FFFFFF", sw=1.2, rx=r))
    # face blob
    kids.append(make_path("avatar-face", parent, frame, circle(cx, cy - 1, r * 0.55, 16), stroke=None, fill="#E8B298", sw=0))
    # fix: make_path with fill needs stroke optional - if stroke None empty strokes
    # eyes
    kids.append(make_rect("avatar-eye-l", cx - r * 0.28, cy - r * 0.15, 3, 3, parent, frame, fill="#1A1A1A", stroke=None, rx=1.5))
    kids.append(make_rect("avatar-eye-r", cx + r * 0.12, cy - r * 0.15, 3, 3, parent, frame, fill="#1A1A1A", stroke=None, rx=1.5))
    # smile
    smile = [
        {"command": "move-to", "params": {"x": cx - r * 0.25, "y": cy + r * 0.15}},
        {
            "command": "curve-to",
            "params": {
                "c1x": cx - r * 0.1,
                "c1y": cy + r * 0.35,
                "c2x": cx + r * 0.1,
                "c2y": cy + r * 0.35,
                "x": cx + r * 0.25,
                "y": cy + r * 0.15,
            },
        },
    ]
    kids.append(make_path("avatar-smile", parent, frame, smile, stroke="#1A1A1A", sw=1.3))
    return kids


def main():
    c = Client()
    c.login()
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    meta = c.get(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}

    # ========== 1) Cleanup notes / catalog clutter ==========
    to_del = []
    for oid, o in objs.items():
        n = o.get("name") or ""
        if n.startswith("note") or n in ("Review comments catalog", "note-title", "note-body"):
            to_del.append(oid)
        if n in ("cap/04 Swap BTC to USDT",) or n.startswith("cap/"):
            to_del.append(oid)
        # old section labels if any
        if n.startswith("section ·"):
            to_del.append(oid)
        # objects to replace for comment fixes
        parent = objs.get(o.get("parentId") or "", {}).get("name")
        if parent == "01 Home" and n in (
            "avatar",
            "avatar-ring",
            "avatar-face",
            "avatar-eye-l",
            "avatar-eye-r",
            "avatar-smile",
        ):
            to_del.append(oid)
        if parent == "01b Home privacy" and n in (
            "avatar",
            "avatar-ring",
            "avatar-face",
            "avatar-eye-l",
            "avatar-eye-r",
            "avatar-smile",
        ):
            to_del.append(oid)
        if parent == "02c Receive share sheet" and (
            n.startswith("row-") or n.startswith("opt-") or n in ("sheet-title", "st", "share-preview")
        ):
            to_del.append(oid)
        if parent == "03b Send ready" and n == "micro":
            to_del.append(oid)
        if o.get("type") == "frame" and n in ("03c Send slide early", "05b Display currencies"):
            to_del.append(oid)
            for cid, ch in objs.items():
                if ch.get("parentId") == oid:
                    to_del.append(cid)

    if to_del:
        st, out = c.update(revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in sorted(set(to_del))])
        print("cleanup del", len(set(to_del)), "->", out.get("revn"))
        revn, vern = int(out["revn"]), int(out.get("vern", vern))
        objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
        frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}

    changes = []

    # ========== 2) Comment #20 — smaller higher avatar ==========
    for fr_name in ("01 Home", "01b Home privacy"):
        if fr_name not in frames:
            continue
        fr = frames[fr_name]
        ox, oy, fid = fr["x"], fr["y"], fr["id"]
        # higher (oy+44) and smaller r=14
        for k in random_avatar(ox + 38, oy + 58, 14, fid, fid):
            # fix make_path fill-only
            if k["name"] == "avatar-face":
                k["strokes"] = []
                k["fills"] = [{"fill-color": "#E8B298", "fill-opacity": 1}]
            add(changes, k, fid, fid)

    # ========== 3) Comment #19 — share BIP21 message ==========
    if "02c Receive share sheet" in frames:
        fr = frames["02c Receive share sheet"]
        ox, oy, fid = fr["x"], fr["y"], fr["id"]
        sh = 320
        add(changes, make_text("st", ox + 24, oy + 844 - sh + 28, 340, 22, fid, fid, "Share", size=17, weight="700", align="center"), fid, fid)
        add(
            changes,
            make_text(
                "share-preview",
                ox + 28,
                oy + 844 - sh + 70,
                334,
                60,
                fid,
                fid,
                "This is my address:\nbitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
                size=12,
                color="#CFCFCF",
                align="left",
            ),
            fid,
            fid,
        )
        add(changes, make_rect("row-0", ox + 16, oy + 844 - sh + 150, 358, 48, fid, fid, fill="#2C2C2E", stroke=None, rx=10), fid, fid)
        add(changes, make_text("opt-0", ox + 32, oy + 844 - sh + 164, 320, 22, fid, fid, "Share BIP21 URL", size=14), fid, fid)
        add(changes, make_rect("row-1", ox + 16, oy + 844 - sh + 210, 358, 48, fid, fid, fill="#2C2C2E", stroke=None, rx=10), fid, fid)
        add(changes, make_text("opt-1", ox + 32, oy + 844 - sh + 224, 320, 22, fid, fid, "Copy message", size=14), fid, fid)

    # ========== 4) Comment #21 — 03c early slide (white label) ==========
    # placeholder position; will be moved by organizer
    fr = make_frame("03c Send slide early", 5000, 5000)
    fid, ox, oy = fr["id"], fr["x"], fr["y"]
    kids = []
    kids += _vl.make_logo_group(ox + 150, oy + 48, fid, fid, scale=0.77)
    kids.append(
        make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SEND", size=20, weight="700", align="center")
    )
    kids.append(
        make_text("balance", ox + 40, oy + 145, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center")
    )
    kids.append(
        make_text("fiat", ox + 40, oy + 182, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center")
    )
    kids.append(make_text("l-amt", ox + 28, oy + 230, 100, 18, fid, fid, "amount", size=12, color="#8C8C8C"))
    kids.append(make_rect("f-amt", ox + 28, oy + 250, 334, 48, fid, fid))
    kids.append(make_text("v-amt", ox + 42, oy + 264, 280, 24, fid, fid, "25,000 sats", size=14))
    kids.append(make_text("l-to", ox + 28, oy + 320, 100, 18, fid, fid, "to", size=12, color="#8C8C8C"))
    kids.append(make_rect("f-to", ox + 28, oy + 340, 334, 48, fid, fid))
    kids.append(make_text("v-to", ox + 42, oy + 354, 300, 24, fid, fid, "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfj…", size=14))
    kids.append(make_text("fee", ox + 28, oy + 410, 300, 18, fid, fid, "network fee ~210 sats", size=12, color="#8C8C8C"))
    for k in elastic_slider(ox + 28, oy + 460, fid, fid, progress=0.22):
        kids.append(k)
    kids.append(
        make_text(
            "micro",
            ox + 28,
            oy + 530,
            334,
            36,
            fid,
            fid,
            "early drag · label WHITE (elastic not over text yet)",
            size=10,
            color="#474747",
            align="center",
        )
    )
    fr["shapes"] = [k["id"] for k in kids]
    add(changes, fr, ROOT, fr["id"])
    for k in kids:
        add(changes, k, fid, fid)

    # also refresh 03b micro note for #21
    if "03b Send ready" in frames:
        frb = frames["03b Send ready"]
        # delete old micro if present later via name — add new caption
        add(
            changes,
            make_text(
                "micro",
                frb["x"] + 28,
                frb["y"] + 605,
                334,
                36,
                frb["id"],
                frb["id"],
                "mid/late drag · label BLACK (elastic covers text)",
                size=10,
                color="#474747",
                align="center",
            ),
            frb["id"],
            frb["id"],
        )

    # ========== 5) Missing 05b Display currencies ==========
    fr = make_frame("05b Display currencies", 5100, 5000)
    fid, ox, oy = fr["id"], fr["x"], fr["y"]
    kids = []
    kids += _vl.make_logo_group(ox + 150, oy + 48, fid, fid, scale=0.77)
    kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CURRENCIES", size=20, weight="700", align="center"))
    kids.append(
        make_text(
            "sub",
            ox + 28,
            oy + 145,
            334,
            40,
            fid,
            fid,
            "Shown on Home next to balance",
            size=12,
            color="#8C8C8C",
            align="center",
        )
    )
    for i, (code, on) in enumerate([("USD", True), ("EUR", True), ("GBP", False), ("JPY", False)]):
        yy = oy + 210 + i * 64
        kids.append(make_rect(f"row-{i}", ox + 28, yy, 334, 52, fid, fid))
        kids.append(make_text(f"c-{i}", ox + 44, yy + 14, 200, 24, fid, fid, f"BTC / {code}", size=15))
        kids.append(make_text(f"on-{i}", ox + 280, yy + 14, 60, 24, fid, fid, "ON" if on else "off", size=14, color="#FFFFFF" if on else "#595959", align="right"))
    fr["shapes"] = [k["id"] for k in kids]
    add(changes, fr, ROOT, fr["id"])
    for k in kids:
        add(changes, k, fid, fid)

    print("applying content fixes…")
    revn, vern = push(c, revn, vern, changes)

    # reload after adds
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    frames = {o["name"]: o for o in objs.values() if o.get("type") == "frame"}

    # ========== 6) Reorganize all frames ==========
    # delete duplicate micros on 03b before move? optional
    # remove old section labels from previous runs already cleaned

    move_changes = []
    label_changes = []
    for row_i, (section, names) in enumerate(LAYOUT):
        row_y = ORIGIN_Y + row_i * ROW
        # section label
        lab = make_text(
            f"section · {section}",
            ORIGIN_X,
            row_y - 48,
            900,
            28,
            ROOT,
            ROOT,
            section,
            size=16,
            weight="700",
            color="#FFFFFF",
            align="left",
        )
        # Root frame parent for free labels
        lab["parent-id"] = ROOT
        lab["frame-id"] = ROOT
        add(label_changes, lab, ROOT, ROOT)

        for col_i, name in enumerate(names):
            if name not in frames:
                print("MISSING frame", name)
                continue
            fr = frames[name]
            tx = ORIGIN_X + col_i * COL
            ty = row_y
            dx, dy = tx - fr["x"], ty - fr["y"]
            if abs(dx) < 0.5 and abs(dy) < 0.5:
                print(f"  keep {name}")
                continue
            ids = descendants(fr["id"], objs)
            print(f"  move {name} dx={dx:.0f} dy={dy:.0f} objs={len(ids)}")
            for oid in ids:
                o = objs[oid]
                move_changes.append(
                    {
                        "type": "mod-obj",
                        "id": oid,
                        "page-id": PAGE,
                        "operations": move_ops(o, dx, dy),
                    }
                )

    print("moving boards…")
    revn, vern = push(c, revn, vern, move_changes, chunk=40)
    print("adding section labels…")
    revn, vern = push(c, revn, vern, label_changes)

    # ========== 7) Replies ==========
    threads = {t["seqn"]: t for t in c.get(f"/api/rpc/command/get-comment-threads?file-id={FILE}")}
    replies = {
        19: "Fatto: share sheet mostra anteprima “This is my address:” + BIP21; azione primaria Share BIP21 URL (e Copy message).",
        20: "Fatto: avatar più in alto e più piccolo; faccina geometrica casuale (non iniziali) su Home e privacy.",
        21: "Fatto: 03b = elastico sopra la scritta → testo NERO; nuova 03c Send slide early = elastico corto → testo BIANCO. Stessa logica centrata.",
    }
    # also note about organization on newest? skip
    for seqn, text in replies.items():
        t = threads.get(seqn)
        if not t:
            continue
        st, comments = c.post("/api/rpc/command/get-comments", {"thread-id": t["id"]})
        if any((c.get("content") or "").startswith("Fatto:") for c in (comments or [])):
            print(f"#{seqn} already replied")
            continue
        st, _ = c.reply(t["id"], text)
        print(f"#{seqn} reply {st}")

    # Final layout print
    objs = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    print("\n=== FINAL LAYOUT ===")
    for o in sorted(
        [o for o in objs.values() if o.get("type") == "frame" and o.get("name") not in ("Root Frame",)],
        key=lambda x: (x["y"], x["x"]),
    ):
        print(f"  {o['name']:32} x={o['x']:5.0f} y={o['y']:5.0f}")
    print("OK")


if __name__ == "__main__":
    main()
