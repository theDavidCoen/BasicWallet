#!/usr/bin/env python3
"""Create editable native Penpot boards for Basic Wallet (comment fixes applied)."""
from __future__ import annotations

import json
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
PAGE = "0d808482-264d-8195-8008-a46d9fbf8811"
ROOT = "00000000-0000-0000-0000-000000000000"
BASE = "http://192.168.1.104:9001"
EMAIL = "info@davidcoen.it"
PASSWORD = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", PASSWORD).group(1).strip()


def uid() -> str:
    return str(uuid.uuid4())


def matrix():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def selrect(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def points(x, y, w, h):
    return [
        {"x": x, "y": y},
        {"x": x + w, "y": y},
        {"x": x + w, "y": y + h},
        {"x": x, "y": y + h},
    ]


def geom(o, x, y, w, h):
    o["x"], o["y"], o["width"], o["height"] = x, y, w, h
    o["selrect"] = selrect(x, y, w, h)
    o["points"] = points(x, y, w, h)
    o["transform"] = matrix()
    o["transform-inverse"] = matrix()
    o["rotation"] = 0
    o["opacity"] = 1
    return o


def shape(typ, name, x, y, w, h, parent, frame):
    o = {
        "id": uid(),
        "name": name,
        "type": typ,
        "parent-id": parent,
        "frame-id": frame,
        "fills": [],
        "strokes": [],
    }
    return geom(o, x, y, w, h)


def make_frame(name, x, y, w=390, h=844):
    fid = uid()
    o = shape("frame", name, x, y, w, h, ROOT, fid)
    o["id"] = fid
    o["frame-id"] = fid
    o["fills"] = [{"fill-color": "#000000", "fill-opacity": 1}]
    o["r1"] = o["r2"] = o["r3"] = o["r4"] = 28
    o["shapes"] = []
    o["hide-fill-on-export"] = False
    o["show-content"] = True
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
                                "line-height": "1.2",
                                "font-style": "normal",
                                "text-align": align,
                                "font-size": str(size),
                                "font-weight": str(weight),
                                "font-family": "JetBrains Mono",
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


def make_path(name, x, y, w, h, parent, frame, content, *, stroke="#FFFFFF", sw=1.7, fill=None):
    """content: list of path command maps as Penpot expects plain commands."""
    o = shape("path", name, x, y, w, h, parent, frame)
    o["content"] = content
    if fill:
        o["fills"] = [{"fill-color": fill, "fill-opacity": 1}]
    if stroke:
        o["strokes"] = [
            {
                "stroke-color": stroke,
                "stroke-opacity": 1,
                "stroke-style": "solid",
                "stroke-width": sw,
                "stroke-alignment": "center",
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
            }
        ]
    return o


def logo_paths(ox, oy, parent, frame, scale=1.0):
    """Official Bitcoin.svg B (stroked outline) + asic text — native vectors only."""
    import importlib.util
    from pathlib import Path

    mod_path = Path(__file__).with_name("penpot_vector_logo.py")
    spec = importlib.util.spec_from_file_location("penpot_vector_logo", mod_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.make_logo_group(ox, oy, parent, frame, scale=scale)


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def post(self, path, data=None, form=None):
        url = BASE + path
        if form is not None:
            # multipart not needed
            raise NotImplementedError
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={"content-type": "application/json"},
            method="POST" if body is not None else "GET",
        )
        with self.opener.open(req) as r:
            raw = r.read()
            return r.status, raw

    def get(self, path):
        req = urllib.request.Request(BASE + path, method="GET")
        with self.opener.open(req) as r:
            return r.status, r.read()

    def login(self):
        self.post(
            "/api/rpc/command/login-with-password",
            {"email": EMAIL, "password": PASSWORD},
        )

    def get_file(self):
        _, raw = self.get(f"/api/rpc/command/get-file?id={FILE}")
        text = raw.decode()
        revn = int(re.search(r'~:revn",(\d+)', text).group(1))
        vern = int(re.search(r'~:vern",(\d+)', text).group(1))
        return revn, vern, text

    def update(self, revn, vern, changes):
        session = uid()
        status, raw = self.post(
            "/api/rpc/command/update-file",
            {
                "id": FILE,
                "session-id": session,
                "revn": revn,
                "vern": vern,
                "changes": changes,
            },
        )
        return status, raw.decode()


def add(objs, parent_frame, bucket):
    for o in objs:
        bucket.append(
            {
                "type": "add-obj",
                "id": o["id"],
                "page-id": PAGE,
                "frame-id": parent_frame if parent_frame != ROOT else (o["frame-id"] if o["type"] == "frame" else ROOT),
                "parent-id": o["parent-id"],
                "obj": o,
            }
        )
        if parent_frame != ROOT and o["type"] != "frame":
            # track children on frame object later
            pass


def build_screens():
    changes = []
    frames_meta = []

    def screen(name, ox, oy, build_kids):
        # caption
        cap = make_text(f"cap/{name}", ox, oy - 36, 380, 24, ROOT, ROOT, name, size=14, color="#111111", weight="700")
        changes.append(
            {"type": "add-obj", "id": cap["id"], "page-id": PAGE, "frame-id": ROOT, "parent-id": ROOT, "obj": cap}
        )
        fr = make_frame(name, ox, oy)
        kids = build_kids(fr["id"], ox, oy)
        fr["shapes"] = [k["id"] for k in kids]
        changes.append(
            {"type": "add-obj", "id": fr["id"], "page-id": PAGE, "frame-id": ROOT, "parent-id": ROOT, "obj": fr}
        )
        for k in kids:
            changes.append(
                {
                    "type": "add-obj",
                    "id": k["id"],
                    "page-id": PAGE,
                    "frame-id": fr["id"],
                    "parent-id": fr["id"],
                    "obj": k,
                }
            )
        frames_meta.append(fr["id"])

    def home(fid, ox, oy, privacy=False):
        kids = []
        kids += logo_paths(ox + 145, oy + 70, fid, fid, 1.0)
        if privacy:
            kids.append(
                make_text("balance", ox + 40, oy + 250, 310, 40, fid, fid, "****** sats", size=28, weight="700", align="center")
            )
            kids.append(
                make_text("fiat", ox + 40, oy + 292, 310, 24, fid, fid, "tap to show", size=13, color="#8C8C8C", align="center")
            )
        else:
            kids.append(
                make_text(
                    "balance", ox + 40, oy + 250, 310, 40, fid, fid, "1,234,567 sats", size=28, weight="700", align="center"
                )
            )
            kids.append(
                make_text(
                    "fiat",
                    ox + 40,
                    oy + 292,
                    310,
                    24,
                    fid,
                    fid,
                    "EUR 6,019 / USD 6,492",
                    size=13,
                    color="#8C8C8C",
                    align="center",
                )
            )
        kids.append(make_rect("btn-receive", ox + 70, oy + 360, 110, 48, fid, fid))
        kids.append(make_text("label-receive", ox + 70, oy + 374, 110, 24, fid, fid, "Receive", size=16, align="center"))
        kids.append(make_rect("btn-send", ox + 230, oy + 360, 90, 48, fid, fid))
        kids.append(make_text("label-send", ox + 230, oy + 374, 90, 24, fid, fid, "Send", size=16, align="center"))
        # swap icon as simple text
        kids.append(make_text("swap-ico", ox + 185, oy + 372, 30, 28, fid, fid, "v", size=18, align="center"))
        return kids

    screen("01 Home", 0, 80, lambda f, x, y: home(f, x, y, False))
    screen("01b Home privacy", 450, 80, lambda f, x, y: home(f, x, y, True))

    def receive(fid, ox, oy):
        kids = []
        kids += logo_paths(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "RECEIVE BTC", size=20, weight="700", align="center"))
        kids.append(make_rect("qr-pod", ox + 85, oy + 150, 220, 220, fid, fid, fill="#1A1A1A", stroke=None, rx=16))
        kids.append(make_rect("qr", ox + 110, oy + 175, 170, 170, fid, fid, fill="#FFFFFF", stroke=None, rx=4))
        kids.append(
            make_text(
                "hint", ox + 40, oy + 385, 310, 20, fid, fid, "Scan BIP21 or copy below", size=12, color="#8C8C8C", align="center"
            )
        )
        kids.append(make_rect("pill", ox + 28, oy + 420, 334, 44, fid, fid, stroke="#FFFFFF", rx=22))
        kids.append(
            make_text(
                "bip21",
                ox + 36,
                oy + 432,
                318,
                24,
                fid,
                fid,
                "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
                size=9,
                align="center",
            )
        )
        kids.append(make_text("copy", ox + 200, oy + 478, 150, 20, fid, fid, "Copy address", size=12, align="right"))
        kids.append(make_rect("modal", ox + 28, oy + 520, 334, 200, fid, fid, fill="#0D0D0D", stroke="#666666", rx=12))
        kids.append(make_text("m-title", ox + 44, oy + 536, 200, 18, fid, fid, "Address options", size=12, color="#8C8C8C"))
        for i, label in enumerate(
            ["BIP21 URL", "Native segwit (bc1)", "Taproot", "Ark address", "Lightning invoice"]
        ):
            kids.append(make_text(f"opt-{i}", ox + 44, oy + 568 + i * 28, 280, 20, fid, fid, label, size=12))
        return kids

    screen("02 Receive BIP21", 900, 80, receive)

    def send_empty(fid, ox, oy):
        kids = []
        kids += logo_paths(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(
            make_text("balance", ox + 40, oy + 100, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center")
        )
        kids.append(
            make_text(
                "fiat", ox + 40, oy + 136, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center"
            )
        )
        kids.append(make_text("title", ox + 40, oy + 170, 310, 28, fid, fid, "SEND", size=20, weight="700", align="center"))
        kids.append(make_text("l-amt", ox + 28, oy + 220, 100, 18, fid, fid, "amount", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-amt", ox + 28, oy + 240, 334, 48, fid, fid))
        kids.append(make_text("ph-amt", ox + 42, oy + 254, 280, 24, fid, fid, "enter amount", size=14, color="#595959"))
        kids.append(make_text("sub", ox + 28, oy + 300, 200, 18, fid, fid, "approx - / -", size=12, color="#8C8C8C"))
        kids.append(make_text("l-to", ox + 28, oy + 330, 100, 18, fid, fid, "to", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-to", ox + 28, oy + 350, 334, 48, fid, fid))
        kids.append(
            make_text("ph-to", ox + 42, oy + 364, 280, 24, fid, fid, "address / npub / contact", size=14, color="#595959")
        )
        kids.append(make_rect("btn", ox + 28, oy + 420, 334, 48, fid, fid))
        kids.append(
            make_text("choose", ox + 28, oy + 434, 334, 24, fid, fid, "Choose Recipient", size=16, align="center")
        )
        kids.append(
            make_text(
                "hint",
                ox + 28,
                oy + 485,
                334,
                18,
                fid,
                fid,
                "fill amount + recipient to confirm",
                size=11,
                color="#474747",
                align="center",
            )
        )
        kids.append(make_rect("qr", ox + 163, oy + 620, 64, 64, fid, fid, rx=12))
        kids.append(make_text("scan", ox + 40, oy + 700, 310, 18, fid, fid, "scan QR", size=12, color="#8C8C8C", align="center"))
        return kids

    screen("03 Send empty", 1350, 80, send_empty)

    def send_ready(fid, ox, oy):
        kids = []
        kids += logo_paths(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(
            make_text("balance", ox + 40, oy + 100, 310, 36, fid, fid, "1,234,567 sats", size=28, weight="700", align="center")
        )
        kids.append(
            make_text(
                "fiat", ox + 40, oy + 136, 310, 22, fid, fid, "EUR 6,019 / USD 6,492", size=13, color="#8C8C8C", align="center"
            )
        )
        kids.append(make_text("title", ox + 40, oy + 170, 310, 28, fid, fid, "SEND", size=20, weight="700", align="center"))
        kids.append(make_text("l-amt", ox + 28, oy + 220, 100, 18, fid, fid, "amount", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-amt", ox + 28, oy + 240, 334, 48, fid, fid))
        kids.append(make_text("v-amt", ox + 42, oy + 254, 280, 24, fid, fid, "25,000 sats", size=14))
        kids.append(
            make_text(
                "sub", ox + 28, oy + 300, 320, 18, fid, fid, "approx EUR 12.18 / USD 13.14", size=12, color="#8C8C8C"
            )
        )
        kids.append(make_text("l-to", ox + 28, oy + 330, 100, 18, fid, fid, "to", size=12, color="#8C8C8C"))
        kids.append(make_rect("f-to", ox + 28, oy + 350, 334, 48, fid, fid))
        kids.append(
            make_text("v-to", ox + 42, oy + 364, 300, 24, fid, fid, "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfj...", size=14)
        )
        kids.append(make_rect("btn", ox + 28, oy + 420, 334, 48, fid, fid))
        kids.append(
            make_text("choose", ox + 28, oy + 434, 334, 24, fid, fid, "Choose Recipient", size=16, align="center")
        )
        kids.append(
            make_text("fee", ox + 28, oy + 485, 300, 18, fid, fid, "network fee ~210 sats", size=12, color="#8C8C8C")
        )
        kids.append(make_rect("slider", ox + 28, oy + 520, 334, 52, fid, fid))
        kids.append(make_rect("slider-fill", ox + 28, oy + 520, 184, 52, fid, fid, fill="#FFFFFF", stroke=None, rx=8))
        kids.append(make_rect("handle", ox + 186, oy + 526, 40, 40, fid, fid, fill="#FFFFFF", stroke="#000000", rx=6))
        kids.append(make_text("handle-gt", ox + 186, oy + 534, 40, 24, fid, fid, ">", size=16, color="#000000", weight="700", align="center"))
        kids.append(make_text("slide", ox + 120, oy + 536, 200, 24, fid, fid, "slide to confirm", size=13, color="#111111"))
        kids.append(
            make_text(
                "micro", ox + 28, oy + 585, 320, 16, fid, fid, "drag: white fill grows until full", size=10, color="#474747"
            )
        )
        return kids

    screen("03b Send ready", 1800, 80, send_ready)

    def swap(fid, ox, oy):
        kids = []
        kids += logo_paths(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "SWAP", size=20, weight="700", align="center"))
        kids.append(make_rect("card-from", ox + 28, oy + 160, 334, 80, fid, fid))
        kids.append(make_text("from-l", ox + 44, oy + 175, 200, 18, fid, fid, "from Bitcoin", size=12, color="#8C8C8C"))
        kids.append(make_text("from-v", ox + 44, oy + 200, 250, 28, fid, fid, "100,000 sats", size=18, weight="700"))
        kids.append(make_text("mid", ox + 40, oy + 255, 310, 24, fid, fid, "v", size=18, align="center"))
        kids.append(make_rect("card-to", ox + 30, oy + 300, 334, 80, fid, fid))
        kids.append(make_text("to-l", ox + 44, oy + 315, 200, 18, fid, fid, "to USDT", size=12, color="#8C8C8C"))
        kids.append(make_text("to-v", ox + 44, oy + 340, 250, 28, fid, fid, "76.42 USDT", size=18, weight="700"))
        kids.append(
            make_text("rate", ox + 28, oy + 405, 330, 18, fid, fid, "rate 1 BTC approx USD 76,420", size=12, color="#8C8C8C")
        )
        kids.append(make_rect("slider", ox + 28, oy + 450, 334, 52, fid, fid))
        kids.append(make_rect("handle", ox + 34, oy + 456, 40, 40, fid, fid, fill="#FFFFFF", stroke=None, rx=6))
        kids.append(make_text("handle-gt", ox + 34, oy + 464, 40, 24, fid, fid, ">", size=16, color="#000000", weight="700", align="center"))
        kids.append(make_text("slide", ox + 100, oy + 466, 220, 24, fid, fid, "slide to swap", size=13, align="center"))
        return kids

    screen("04 Swap BTC to USDT", 2250, 80, swap)

    def node(fid, ox, oy):
        kids = []
        kids += logo_paths(ox + 150, oy + 48, fid, fid, 0.77)
        kids.append(
            make_text("title", ox + 40, oy + 100, 310, 28, fid, fid, "CONNECT NODE", size=20, weight="700", align="center")
        )
        kids.append(
            make_text(
                "h1", ox + 40, oy + 155, 310, 20, fid, fid, "send and receive via LND only", size=12, color="#8C8C8C", align="center"
            )
        )
        kids.append(
            make_text(
                "h2",
                ox + 40,
                oy + 175,
                310,
                20,
                fid,
                fid,
                "no channel management in-app",
                size=12,
                color="#8C8C8C",
                align="center",
            )
        )
        cards = [
            (230, "BTCPay Server", "Link to pay / receive over Lightning"),
            (330, "Nostr Wallet Connect", "Paste NWC string"),
            (430, "Manual LND", "macaroon + endpoint (payments only)"),
        ]
        for i, (yy, t, d) in enumerate(cards):
            kids.append(make_rect(f"card-{i}", ox + 28, oy + yy, 334, 80, fid, fid))
            kids.append(make_text(f"t-{i}", ox + 44, oy + yy + 20, 300, 24, fid, fid, t, size=16, weight="700"))
            kids.append(make_text(f"d-{i}", ox + 44, oy + yy + 48, 300, 20, fid, fid, d, size=12, color="#8C8C8C"))
        return kids

    screen("06 Connect Node", 2700, 80, node)
    return changes


def find_image_ids(file_text: str):
    # find shape named Basic Wallet screens
    ids = re.findall(r'~u([0-9a-f-]{36})', file_text)
    # better: del by known previous shape if present in layers - use get-page?
    return []


def main():
    c = Client()
    c.login()
    revn, vern, ftext = c.get_file()
    print(f"revn={revn} vern={vern}")

    # Delete old image layer if we can find its id from a prior known id pattern in changes.
    # Try common: search get-file-fragment - instead del-obj with ids from workspace via get-page
    status, page_raw = c.get(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")
    page_txt = page_raw.decode(errors="replace")
    # Extract object names near ids is hard in transit. Delete by matching name via regex loosely.
    # Find add-obj lagged id from earlier: b7e95c6e-a347-470e-826f-b59f4ea0fd3b
    old_ids = set(
        re.findall(
            r'Basic Wallet screens \(comments applied\).*?~u([0-9a-f-]{36})',
            page_txt,
            flags=re.S,
        )
    )
    # Also try reverse: id then name
    for m in re.finditer(r'~:id","~u([0-9a-f-]{36})".{0,200}Basic Wallet screens', page_txt, flags=re.S):
        old_ids.add(m.group(1))
    for m in re.finditer(r'Basic Wallet screens.{0,200}~:id","~u([0-9a-f-]{36})', page_txt, flags=re.S):
        old_ids.add(m.group(1))

    # Fallback known id from earlier session response
    old_ids.add("b7e95c6e-a347-470e-826f-b59f4ea0fd3b")
    old_ids.add("d8dd0779-0147-46ea-ba3c-9520b6347801")

    del_changes = [{"type": "del-obj", "id": i, "page-id": PAGE} for i in sorted(old_ids)]
    print("delete candidates", len(del_changes), old_ids)

    if del_changes:
        st, out = c.update(revn, vern, del_changes)
        print("delete", st, out[:300])
        revn, vern, _ = c.get_file()
        print(f"after delete revn={revn}")

    changes = build_screens()
    print("adding", len(changes), "objects")
    # batch to avoid huge payload issues
    batch = 40
    for i in range(0, len(changes), batch):
        chunk = changes[i : i + batch]
        st, out = c.update(revn, vern, chunk)
        print(f"batch {i}-{i+len(chunk)} -> {st}", out[:400])
        if st != 200:
            Path("/tmp/penpot-update-error.txt").write_text(out)
            raise SystemExit(1)
        # parse new revn from response if present else refresh
        m = re.search(r'~:revn",(\d+)', out)
        if m:
            # response sometimes returns old revn with lagged; refresh
            revn, vern, _ = c.get_file()
        else:
            revn, vern, _ = c.get_file()
        print(f"  revn now {revn}")

    print("OK")


if __name__ == "__main__":
    main()
