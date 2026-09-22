#!/usr/bin/env python3
"""
Replace raster/SVG-image logos on Penpot boards with native vectors:
  - Bitcoin.svg official B path (stroke outline, already tilted)
  - text "asic" (JetBrains Mono)
Also refresh prototype/logo-basic.svg (pure vector).
"""
from __future__ import annotations

import json
import math
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
PAGE = "0d808482-264d-8195-8008-a46d9fbf8811"
ROOT = "00000000-0000-0000-0000-000000000000"
BASE = "http://192.168.1.104:9001"
ENV = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
EMAIL = re.search(r"PENPOT_EMAIL=(.*)", ENV).group(1).strip()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", ENV).group(1).strip()

BITCOIN_SVG = Path("/home/david/Documenti/BasicWallet/Bitcoin.svg")
LOGO_SVG_OUT = Path("/home/david/Documenti/BasicWallet/prototype/logo-basic.svg")

# Official white B path from Bitcoin.svg (glyph already tilted ~14°)
B_PATH_D = re.search(
    r'fill="#FFF" d="([^"]+)"', BITCOIN_SVG.read_text()
).group(1)


# --- SVG path → absolute cubic/line commands ---
def _tokenize(d: str):
    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", d)
    return tokens


def parse_svg_path(d: str) -> list[dict]:
    """Return Penpot-style path commands with absolute coords."""
    tokens = _tokenize(d)
    i = 0
    cx = cy = 0.0
    sx = sy = 0.0  # subpath start
    last_c2x = last_c2y = None
    last_was_cubic = False
    out: list[dict] = []

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        cmd = tokens[i]
        if cmd.isalpha():
            i += 1
        else:
            # implicit repeat of previous command
            cmd = prev
        prev = cmd
        abs_cmd = cmd.upper()
        rel = cmd.islower()

        if abs_cmd == "M":
            x, y = num(), num()
            if rel:
                x += cx
                y += cy
            cx, cy = x, y
            sx, sy = x, y
            out.append({"command": "move-to", "params": {"x": x, "y": y}})
            last_was_cubic = False
            # subsequent pairs are line-to
            while i < len(tokens) and not tokens[i].isalpha():
                x, y = num(), num()
                if rel:
                    x += cx
                    y += cy
                cx, cy = x, y
                out.append({"command": "line-to", "params": {"x": x, "y": y}})
        elif abs_cmd == "L":
            while True:
                x, y = num(), num()
                if rel:
                    x += cx
                    y += cy
                cx, cy = x, y
                out.append({"command": "line-to", "params": {"x": x, "y": y}})
                if i >= len(tokens) or tokens[i].isalpha():
                    break
            last_was_cubic = False
        elif abs_cmd == "H":
            while True:
                x = num()
                if rel:
                    x += cx
                cx = x
                out.append({"command": "line-to", "params": {"x": cx, "y": cy}})
                if i >= len(tokens) or tokens[i].isalpha():
                    break
            last_was_cubic = False
        elif abs_cmd == "V":
            while True:
                y = num()
                if rel:
                    y += cy
                cy = y
                out.append({"command": "line-to", "params": {"x": cx, "y": cy}})
                if i >= len(tokens) or tokens[i].isalpha():
                    break
            last_was_cubic = False
        elif abs_cmd == "C":
            while True:
                c1x, c1y, c2x, c2y, x, y = num(), num(), num(), num(), num(), num()
                if rel:
                    c1x += cx
                    c1y += cy
                    c2x += cx
                    c2y += cy
                    x += cx
                    y += cy
                out.append(
                    {
                        "command": "curve-to",
                        "params": {
                            "c1x": c1x,
                            "c1y": c1y,
                            "c2x": c2x,
                            "c2y": c2y,
                            "x": x,
                            "y": y,
                        },
                    }
                )
                cx, cy = x, y
                last_c2x, last_c2y = c2x, c2y
                last_was_cubic = True
                if i >= len(tokens) or tokens[i].isalpha():
                    break
        elif abs_cmd == "S":
            while True:
                c2x, c2y, x, y = num(), num(), num(), num()
                if rel:
                    c2x += cx
                    c2y += cy
                    x += cx
                    y += cy
                if last_was_cubic and last_c2x is not None:
                    c1x = 2 * cx - last_c2x
                    c1y = 2 * cy - last_c2y
                else:
                    c1x, c1y = cx, cy
                out.append(
                    {
                        "command": "curve-to",
                        "params": {
                            "c1x": c1x,
                            "c1y": c1y,
                            "c2x": c2x,
                            "c2y": c2y,
                            "x": x,
                            "y": y,
                        },
                    }
                )
                cx, cy = x, y
                last_c2x, last_c2y = c2x, c2y
                last_was_cubic = True
                if i >= len(tokens) or tokens[i].isalpha():
                    break
        elif abs_cmd == "Z":
            out.append({"command": "close-path", "params": {}})
            cx, cy = sx, sy
            last_was_cubic = False
        else:
            raise ValueError(f"unsupported SVG command {cmd}")

    return out


def transform_commands(cmds: list[dict], *, ox: float, oy: float, scale: float) -> list[dict]:
    out = []
    for c in cmds:
        if c["command"] == "close-path":
            out.append({"command": "close-path", "params": {}})
            continue
        p = dict(c["params"])
        for k in list(p):
            if k.endswith("x") or k == "x":
                p[k] = p[k] * scale + ox
            elif k.endswith("y") or k == "y":
                p[k] = p[k] * scale + oy
        out.append({"command": c["command"], "params": p})
    return out


def bbox_of(cmds: list[dict]):
    xs, ys = [], []
    for c in cmds:
        p = c.get("params") or {}
        for k, v in p.items():
            if k.endswith("x") or k == "x":
                xs.append(v)
            elif k.endswith("y") or k == "y":
                ys.append(v)
    return min(xs), min(ys), max(xs), max(ys)


def uid() -> str:
    return str(uuid.uuid4())


def matrix():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def selrect(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def points(x, y, w, h):
    return [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]


def geom(o, x, y, w, h):
    o["x"], o["y"], o["width"], o["height"] = x, y, w, h
    o["selrect"] = selrect(x, y, w, h)
    o["points"] = points(x, y, w, h)
    o["transform"] = matrix()
    o["transform-inverse"] = matrix()
    o["rotation"] = 0
    o["opacity"] = 1
    return o


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def post_json(self, path, data):
        req = urllib.request.Request(
            BASE + path,
            data=json.dumps(data).encode(),
            headers={"content-type": "application/json", "accept": "application/json"},
            method="POST",
        )
        with self.opener.open(req) as r:
            return r.status, json.loads(r.read().decode())

    def get_json(self, path):
        req = urllib.request.Request(
            BASE + path, headers={"accept": "application/json"}, method="GET"
        )
        with self.opener.open(req) as r:
            return json.loads(r.read().decode())

    def login(self):
        self.post_json("/api/rpc/command/login-with-password", {"email": EMAIL, "password": PASSWORD})


def make_text(name, x, y, w, h, parent, frame, text, *, size=26, color="#FFFFFF", weight="400"):
    o = {
        "id": uid(),
        "name": name,
        "type": "text",
        "parent-id": parent,
        "frame-id": frame,
        "fills": [],
        "strokes": [],
        "grow-type": "auto-width",
        "content": {
            "type": "root",
            "vertical-align": "top",
            "children": [
                {
                    "type": "paragraph-set",
                    "children": [
                        {
                            "type": "paragraph",
                            "text-align": "left",
                            "children": [
                                {
                                    "line-height": "1",
                                    "font-style": "normal",
                                    "text-align": "left",
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
        },
    }
    return geom(o, x, y, w, h)


def make_btc_path(name, x, y, scale, parent, frame, *, stroke_w=1.2):
    """Native Penpot path: official Bitcoin B as white outline."""
    base = parse_svg_path(B_PATH_D)
    # Original glyph sits in ~64x64 coin; shift so top-left of glyph bbox ≈ (x,y)
    bx0, by0, bx1, by1 = bbox_of(base)
    cmds = transform_commands(base, ox=x - bx0 * scale, oy=y - by0 * scale, scale=scale)
    x0, y0, x1, y1 = bbox_of(cmds)
    # pad for stroke
    pad = stroke_w
    o = {
        "id": uid(),
        "name": name,
        "type": "path",
        "parent-id": parent,
        "frame-id": frame,
        "content": cmds,
        "fills": [],
        "strokes": [
            {
                "stroke-color": "#FFFFFF",
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": stroke_w,
                "stroke-alignment": "center",
            }
        ],
    }
    return geom(o, x0 - pad, y0 - pad, (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad)


def make_logo_group(ox, oy, parent, frame, *, scale=1.0):
    """Return [path, text] positioned as Basic wordmark."""
    # Bitcoin B glyph natural size ~30x44 in coin space; scale maps coin units → px
    b_scale = 1.05 * scale
    stroke = 1.15 * scale
    b = make_btc_path("logo-B", ox, oy, b_scale, parent, frame, stroke_w=stroke)
    # asic sits to the right of B, vertically centered on B body
    asic_size = int(round(28 * scale))
    tx = b["x"] + b["width"] - 2 * scale
    ty = b["y"] + b["height"] * 0.28
    t = make_text("logo-asic", tx, ty, int(100 * scale), int(36 * scale), parent, frame, "asic", size=asic_size)
    return [b, t]


def write_logo_svg():
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="190" height="56" viewBox="0 0 190 56" fill="none">
  <!-- B = official path from Bitcoin.svg (tilt baked in), stroked hollow to match Basic wordmark -->
  <g transform="translate(-6,-9) scale(1.05)">
    <path d="{B_PATH_D}" fill="none" stroke="#FFFFFF" stroke-width="1.15"
          stroke-linejoin="miter" stroke-miterlimit="4"/>
  </g>
  <text x="40" y="38" fill="#FFFFFF"
        font-family="JetBrains Mono, Liberation Mono, monospace"
        font-size="32" font-weight="400" letter-spacing="0.5">asic</text>
</svg>
'''
    LOGO_SVG_OUT.write_text(svg)
    print("wrote", LOGO_SVG_OUT)


def main():
    write_logo_svg()
    c = Client()
    c.login()
    objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    frames = {
        o["name"]: o
        for o in objs.values()
        if o.get("type") == "frame" and not (o.get("name") or "").startswith("note")
        and o.get("name") not in ("Root Frame", "Review comments catalog")
        and not (o.get("name") or "").startswith("note ·")
    }

    to_del = [
        oid
        for oid, o in objs.items()
        if o.get("name") in ("logo-Basic", "logo-B", "logo-asic")
    ]
    meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
    revn, vern = int(meta["revn"]), int(meta["vern"])
    if to_del:
        st, out = c.post_json(
            "/api/rpc/command/update-file",
            {
                "id": FILE,
                "session-id": uid(),
                "revn": revn,
                "vern": vern,
                "changes": [{"type": "del-obj", "id": i, "page-id": PAGE} for i in to_del],
            },
        )
        print("deleted", len(to_del), st)
        meta = c.get_json(f"/api/rpc/command/get-file?id={FILE}")
        revn, vern = int(meta["revn"]), int(meta["vern"])
        objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
        frames = {
            o["name"]: o
            for o in objs.values()
            if o.get("type") == "frame"
            and o.get("name") not in ("Root Frame", "Review comments catalog")
            and not (o.get("name") or "").startswith("note ·")
        }

    changes = []
    for name, fr in frames.items():
        ox, oy = fr["x"], fr["y"]
        if name.startswith("01"):
            lx, ly, sc = ox + 128, oy + 62, 1.0
        else:
            lx, ly, sc = ox + 145, oy + 42, 0.72
        kids = make_logo_group(lx, ly, fr["id"], fr["id"], scale=sc)
        for kid in kids:
            changes.append(
                {
                    "type": "add-obj",
                    "id": kid["id"],
                    "page-id": PAGE,
                    "frame-id": fr["id"],
                    "parent-id": fr["id"],
                    "obj": kid,
                }
            )
        print("vector logo on", name)

    st, out = c.post_json(
        "/api/rpc/command/update-file",
        {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
    )
    print("add", st, "n", len(changes), "revn", out.get("revn"))
    if st != 200:
        print(out)
        raise SystemExit(1)

    # verify no logo-Basic image left
    objs = c.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")["objects"]
    imgs = [o["name"] for o in objs.values() if o.get("name") == "logo-Basic"]
    paths = [o for o in objs.values() if o.get("name") == "logo-B" and o.get("type") == "path"]
    print("remaining image logos", imgs, "vector B paths", len(paths))
    print("OK")


if __name__ == "__main__":
    main()
