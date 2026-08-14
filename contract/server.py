#!/usr/bin/env python3
"""Records what an SDK puts on the wire.

Every runner performs the same fixed sequence of calls against this server.
The server answers identically for all of them and writes a normalised trace of
what it received, so the five traces can be compared to each other.

    python3 contract/server.py 8940 traces/typescript.json
"""
import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlparse

#  Headers worth comparing. Everything else is transport noise.
INTERESTING_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "idempotency-key",
    "last-event-id",
)

AGENT = {
    "agent_id": "a1",
    "tenant_id": "t1",
    "name": "demo",
    "model": {"provider": "openai_compat", "model_ref": "gpt-x", "capabilities": {}},
    "created_at": "2026-01-01T00:00:00Z",
    "execution_mode": "worker",
}

PUBLISHED = {
    "scope": "@demo",
    "name": "bundle",
    "version": "1.0.0",
    "publisher_tenant_id": "t1",
    "manifest": {"name": "demo"},
    "sha256": "abc123",
    "size_bytes": 3,
    "visibility": "public",
    "published_at": "2026-01-01T00:00:00Z",
}

BINARY = bytes([0x00, 0xFF, 0x41, 0x00, 0x42])

state = {"trace": [], "retry_seen": 0}
lock = threading.Lock()


def normalise_headers(headers) -> dict:
    """Keep the headers that carry meaning, with volatile values masked."""
    out = {}
    for name in INTERESTING_HEADERS:
        value = headers.get(name)
        if value is None:
            continue
        if name == "idempotency-key":
            #  A fresh UUID every time; only its presence and shape matter.
            value = "<uuid>" if re.fullmatch(r"[0-9a-fA-F-]{36}", value) else f"<literal:{value}>"
        if name == "content-type":
            value = re.sub(r"boundary=[^;]+", "boundary=<boundary>", value)
        out[name] = value
    return out


def normalise_body(body: bytes, content_type: str):
    """Describe a body in a way five languages can agree on."""
    if not body:
        return None
    if "json" in content_type:
        try:
            return {"json": json.loads(body)}
        except ValueError:
            return {"text": body.decode("utf-8", "replace")}
    if "multipart" in content_type:
        boundary = content_type.split("boundary=", 1)[1].strip().strip('"')
        parts = {}
        for chunk in body.split(("--" + boundary).encode()):
            head, separator, data = chunk.partition(b"\r\n\r\n")
            if not separator:
                continue
            name = re.search(rb'name="([^"]*)"', head)
            if not name:
                continue
            filename = re.search(rb'filename="([^"]*)"', head)
            payload = data[:-2] if data.endswith(b"\r\n") else data
            parts[name.group(1).decode()] = {
                #  Filenames differ by design: only some languages carry one.
                "has_filename": filename is not None,
                "bytes": payload.hex(),
            }
        return {"multipart": parts}
    return {"bytes": body.hex()}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _record(self, body: bytes):
        parsed = urlparse(self.path)
        with lock:
            state["trace"].append(
                {
                    "method": self.command,
                    #  Raw, so percent-encoding differences show up.
                    "path": parsed.path,
                    #  Both the decoded pairs and the raw string: `a+b` and
                    #  `a%20b` decode the same but are not the same bytes.
                    "query": sorted(parse_qsl(parsed.query, keep_blank_values=True)),
                    "raw_query": parsed.query,
                    "headers": normalise_headers(self.headers),
                    "body": normalise_body(body, self.headers.get("Content-Type", "")),
                }
            )

    def _send(self, status, payload: bytes, content_type="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def _json(self, status, value, extra=None):
        self._send(status, json.dumps(value).encode(), extra=extra)

    def _route(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        parsed = urlparse(self.path)
        path = parsed.path
        query = dict(parse_qsl(parsed.query))

        #  The control endpoints are the harness talking, not the SDK.
        if path == "/__trace":
            with lock:
                return self._send(200, json.dumps(state["trace"], indent=2).encode())
        if path == "/__reset":
            with lock:
                state["trace"] = []
                state["retry_seen"] = 0
            return self._json(200, {"ok": True})

        self._record(body)

        if path == "/api/v1/agents" and self.command == "GET":
            if query.get("cursor") is None:
                return self._json(200, {"items": [AGENT], "cursor": "next", "has_more": True})
            return self._json(
                200, {"items": [dict(AGENT, agent_id="a2")], "cursor": None, "has_more": False}
            )
        if path == "/api/v1/agents" and self.command == "POST":
            return self._json(201, AGENT)
        if path == "/api/v1/agents/retry-me":
            #  One 429, then success: proves the retry and its headers.
            with lock:
                state["retry_seen"] += 1
                first = state["retry_seen"] == 1
            if first:
                return self._json(
                    429,
                    {"title": "Too Many Requests", "status": 429},
                    extra={"Retry-After": "0"},
                )
            return self._json(200, AGENT)
        if path == "/api/v1/agents/missing":
            return self._json(404, {"title": "Not Found", "status": 404, "detail": "no such agent"})
        if path.startswith("/api/v1/agents/"):
            return self._json(200, AGENT)
        if path == "/api/v1/registry/publish":
            return self._json(201, PUBLISHED)
        if path == "/api/v1/files/f1/content":
            return self._send(200, BINARY, content_type="application/octet-stream")
        if path == "/api/v1/files/f1":
            return self._send(204, b"")
        if path == "/api/v1/runs/r1/events":
            frames = (
                b"id: 1\nevent: llm.chunk\ndata: {\"text\":\"he\"}\n\n"
                b"event: run.completed\ndata: {}\n\n"
            )
            return self._send(200, frames, content_type="text/event-stream")
        return self._json(404, {"title": "Not Found", "status": 404, "detail": path})

    do_GET = _route
    do_POST = _route
    do_PUT = _route
    do_PATCH = _route
    do_DELETE = _route


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8940
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"contract server on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
