#!/usr/bin/env python3
"""Replace logo-B / logo-asic on all boards with correct Basic logo (outline ₿ + asic)."""
from __future__ import annotations

import json
import re
import uuid
import urllib.request
import http.cookiejar
from pathlib import Path

FILE = "0d808482-264d-8195-8008-a46d9fbf8810"
PAGE = "0d808482-264d-8195-8008-a46d9fbf8811"
BASE = "http://192.168.1.104:9001"
ENV = Path("/home/david/Documenti/BasicWallet/.secrets/penpot.env").read_text()
EMAIL = re.search(r"PENPOT_EMAIL=(.*)", ENV).group(1).strip()
PASSWORD = re.search(r"PENPOT_PASSWORD=(.*)", ENV).group(1).strip()
LOGO_SVG = Path("/home/david/Documenti/BasicWallet/prototype/logo-basic.svg")


def uid() -> str:
    return str(uuid.uuid4())


def matrix():
    return {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}


def selrect(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "x1": x, "y1": y, "x2": x + w, "y2": y + h}


def points(x, y, w, h):
    return [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def post_json(self, path, data):
        body = json.dumps(data).encode()
        req = urllib.request.Request(
            BASE + path,
            data=body,
            headers={"content-type": "application/json", "accept": "application/json"},
            method="POST",
        )
        with self.opener.open(req) as r:
            return r.status, r.read()

    def get_json(self, path):
        req = urllib.request.Request(
            BASE + path, headers={"accept": "application/json"}, method="GET"
        )
        with self.opener.open(req) as r:
            return r.status, json.loads(r.read().decode())

    def post_multipart(self, path, fields, files):
        boundary = "----Penpot" + uuid.uuid4().hex
        parts = []
        for k, v in fields.items():
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
            )
        for name, (filename, content, ctype) in files.items():
            parts.append(
                (
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
                    f"Content-Type: {ctype}\r\n\r\n"
                ).encode()
                + content
                + b"\r\n"
            )
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        req = urllib.request.Request(
            BASE + path,
            data=body,
            headers={
                "content-type": f"multipart/form-data; boundary={boundary}",
                "accept": "application/json",
            },
            method="POST",
        )
        with self.opener.open(req) as r:
            return r.status, r.read()

    def login(self):
        self.post_json("/api/rpc/command/login-with-password", {"email": EMAIL, "password": PASSWORD})

    def get_file_meta(self):
        _, data = self.get_json(f"/api/rpc/command/get-file?id={FILE}")
        return int(data["revn"]), int(data["vern"])

    def get_page(self):
        _, data = self.get_json(f"/api/rpc/command/get-page?file-id={FILE}&page-id={PAGE}")
        return data["objects"]

    def update(self, revn, vern, changes):
        status, raw = self.post_json(
            "/api/rpc/command/update-file",
            {"id": FILE, "session-id": uid(), "revn": revn, "vern": vern, "changes": changes},
        )
        return status, raw.decode()


def make_logo_image(x, y, w, h, parent, frame, media_id, media_w, media_h):
    sid = uid()
    return {
        "id": sid,
        "name": "logo-Basic",
        "type": "rect",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "rotation": 0,
        "selrect": selrect(x, y, w, h),
        "points": points(x, y, w, h),
        "transform": matrix(),
        "transform-inverse": matrix(),
        "parent-id": parent,
        "frame-id": frame,
        "opacity": 1,
        "r1": 0,
        "r2": 0,
        "r3": 0,
        "r4": 0,
        "fills": [
            {
                "fill-opacity": 1,
                "fill-image": {
                    "id": media_id,
                    "width": media_w,
                    "height": media_h,
                    "mtype": "image/svg+xml",
                    "name": "logo-basic.svg",
                    "keep-aspect-ratio": True,
                },
            }
        ],
        "strokes": [],
    }


def main():
    c = Client()
    c.login()

    st, raw = c.post_multipart(
        "/api/rpc/command/upload-file-media-object",
        {"file-id": FILE, "is-local": "true", "name": "logo-basic.svg"},
        {"content": ("logo-basic.svg", LOGO_SVG.read_bytes(), "image/svg+xml")},
    )
    media = json.loads(raw.decode())
    media_id = media.get("id") or media.get("media-id")
    media_w = int(media.get("width") or 168)
    media_h = int(media.get("height") or 48)
    print("upload", st, "media", media_id, f"{media_w}x{media_h}")

    objects = c.get_page()
    to_delete = []
    frames = {}
    for oid, obj in objects.items():
        name = obj.get("name") or ""
        if name in ("logo-B", "logo-asic", "logo-Basic"):
            to_delete.append(oid)
        if obj.get("type") == "frame" and name:
            frames[name] = obj

    print("delete", len(to_delete), "frames", list(frames))

    revn, vern = c.get_file_meta()
    if to_delete:
        st, out = c.update(
            revn, vern, [{"type": "del-obj", "id": i, "page-id": PAGE} for i in to_delete]
        )
        print("del", st, out[:160])
        revn, vern = c.get_file_meta()

    # Prefer placing relative to deleted logo-B positions if we captured them; else defaults
    # Re-read objects before delete was already done — use frame coords
    changes = []
    for name, frame in frames.items():
        if name == "Root Frame":
            continue
        ox, oy = frame["x"], frame["y"]
        if name.startswith("01"):
            lx, ly, lw, lh = ox + 130, oy + 68, 130, 38
        else:
            lx, ly, lw, lh = ox + 142, oy + 48, 105, 32
        # keep aspect from uploaded SVG
        lh = max(28, int(round(lw * media_h / media_w)))
        logo = make_logo_image(lx, ly, lw, lh, frame["id"], frame["id"], media_id, media_w, media_h)
        changes.append(
            {
                "type": "add-obj",
                "id": logo["id"],
                "page-id": PAGE,
                "frame-id": frame["id"],
                "parent-id": frame["id"],
                "obj": logo,
            }
        )
        print("add logo on", name, "at", lx, ly)

    st, out = c.update(revn, vern, changes)
    print("add", st, out[:300])
    if st != 200:
        raise SystemExit(1)
    print("OK", len(changes), "logos")


if __name__ == "__main__":
    main()
