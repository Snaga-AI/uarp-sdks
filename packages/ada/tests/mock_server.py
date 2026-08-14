#!/usr/bin/env python3
"""Tiny HTTP server the Ada test suite runs against.

Start it with `python3 tests/mock_server.py 8931`, then point the suite at it:
`UARP_TEST_BASE_URL=http://127.0.0.1:8931 ./bin/uarp_sdk_tests`.
"""
import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

FLAKY_STATE = {"attempts": 0}
WRITE_STATE = {"attempts": 0}

#  A complete Agent, since the SDK models decode strictly-typed fields.
AGENT = {
    "agent_id": "a1",
    "tenant_id": "t1",
    "name": "demo",
    "model": {"provider": "openai_compat", "model_ref": "gpt-x", "capabilities": {}},
    "created_at": "2026-01-01T00:00:00Z",
    "execution_mode": "worker",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: D102 - quiet by default
        pass

    def _send(self, status, body: bytes, content_type="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _echo(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        payload = self.rfile.read(length).decode() if length else ""
        body = json.dumps(
            {
                "method": self.command,
                "path": parsed.path,
                "query": parsed.query,
                "authorization": self.headers.get("Authorization", ""),
                "user_agent": self.headers.get("User-Agent", ""),
                "idempotency_key": self.headers.get("Idempotency-Key", ""),
                "content_type": self.headers.get("Content-Type", ""),
                "accept": self.headers.get("Accept", ""),
                "body": payload,
            }
        ).encode()
        self._send(200, body)

    def _events(self):
        query = dict(
            pair.split("=", 1) for pair in urlparse(self.path).query.split("&") if "=" in pair
        )
        tag = query.get("tag", "llm")
        first = f'id: 1\nevent: {tag}.chunk\ndata: {{"text":"he"}}\n\n'.encode()
        second = b"event: run.completed\ndata: {}\n\n"

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(first) + len(second)))
        self.end_headers()
        self.wfile.write(first)
        self.wfile.flush()
        # Hold the connection open briefly so concurrent streams really overlap.
        if "tag" in query:
            time.sleep(0.2)
        self.wfile.write(second)

    def _parse_multipart(self, body: bytes, content_type: str):
        """Split a multipart body into {name: (filename, value)}."""
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
            parts[name.group(1).decode()] = (
                filename.group(1).decode() if filename else None,
                data[: -2] if data.endswith(b"\r\n") else data,
            )
        return parts

    def _publish(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self._send(
                400,
                json.dumps({"title": "expected multipart", "status": 400, "detail": content_type}).encode(),
            )

        parts = self._parse_multipart(body, content_type)
        #  Echo the parts back through fields the response model already has, so
        #  a client can assert on them without a second request.
        return self._send(
            201,
            json.dumps(
                {
                    "scope": parts.get("manifest", (None, b""))[1].decode("latin-1"),
                    "name": parts.get("artifact", (None, b""))[1].hex(),
                    "version": parts.get("artifact", (None, b""))[0] or "no-filename",
                    "sha256": parts.get("sha256", (None, b"absent"))[1].decode("latin-1"),
                    "size_bytes": len(parts.get("artifact", (None, b""))[1]),
                }
            ).encode(),
        )

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/echo":
            return self._echo()
        if path == "/events":
            return self._events()
        if path == "/events/resume":
            #  First connection ends after one event; the reconnect must arrive
            #  with Last-Event-ID and is answered with a final event.
            resumed = self.headers.get("Last-Event-ID")
            if resumed is None:
                frames = b"id: 7\nevent: first\ndata: {}\n\n"
            else:
                #  Ends the stream for good, so a blocking client returns.
                frames = (
                    f"event: resumed.{resumed}\ndata: {{}}\n\n"
                    "event: run.completed\ndata: {}\n\n"
                ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(frames)))
            self.end_headers()
            return self.wfile.write(frames)
        if path == "/events/token":
            #  Echoes back whether the key arrived as a query parameter.
            query = dict(
                pair.split("=", 1) for pair in parsed.query.split("&") if "=" in pair
            )
            name = "token." + query.get("token", "absent")
            frames = f"event: {name}\ndata: {{}}\n\nevent: run.completed\ndata: {{}}\n\n".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(frames)))
            self.end_headers()
            return self.wfile.write(frames)
        if path == "/flaky":
            FLAKY_STATE["attempts"] += 1
            if FLAKY_STATE["attempts"] == 1:
                return self._send(
                    429,
                    json.dumps({"title": "Too Many Requests", "status": 429}).encode(),
                    extra={"Retry-After": "0"},
                )
            return self._send(200, json.dumps({"status": "recovered"}).encode())
        if path == "/status/404":
            return self._send(
                404,
                json.dumps(
                    {
                        "type": "about:blank",
                        "title": "Not Found",
                        "status": 404,
                        "detail": "not found here",
                        "correlationId": "corr-1",
                    }
                ).encode(),
                content_type="application/problem+json",
            )
        if path == "/flaky/write":
            #  Always fails, and counts how many times it was asked to.
            WRITE_STATE["attempts"] += 1
            return self._send(
                500,
                json.dumps({"title": "always fails", "status": 500}).encode(),
                extra={"Retry-After": "0"},
            )
        if path == "/flaky/count":
            return self._send(200, json.dumps({"attempts": WRITE_STATE["attempts"]}).encode())
        if path == "/status/429":
            return self._send(
                429,
                json.dumps({"title": "Too Many Requests", "status": 429}).encode(),
                content_type="application/problem+json",
                extra={
                    "Retry-After": "1.5",
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": "1767225600",
                },
            )
        if path == "/status/422":
            return self._send(
                422,
                json.dumps(
                    {
                        "type": "about:blank",
                        "title": "Unprocessable Entity",
                        "status": 422,
                        "errors": [{"field": "name", "message": "required"}],
                    }
                ).encode(),
                content_type="application/problem+json",
            )
        if path == "/api/v1/agents":
            if self.command == "POST":
                return self._send(201, json.dumps(AGENT).encode())
            query = dict(
                pair.split("=", 1) for pair in parsed.query.split("&") if "=" in pair
            )
            if query.get("stuck") == "1":
                #  Never clears its cursor: the client has to notice and stop.
                return self._send(
                    200,
                    json.dumps({"items": [AGENT], "cursor": "same", "has_more": True}).encode(),
                )
            cursor = query.get("cursor")
            if cursor is None:
                return self._send(
                    200,
                    json.dumps({"items": [AGENT], "cursor": "next", "has_more": True}).encode(),
                )
            return self._send(
                200,
                json.dumps({"items": [dict(AGENT, agent_id="a2")], "cursor": None, "has_more": False}).encode(),
            )
        if path.startswith("/api/v1/agents/"):
            return self._send(200, json.dumps(dict(AGENT, agent_id=path.rsplit("/", 1)[-1])).encode())
        if path == "/api/v1/registry/publish":
            return self._publish()
        if path == "/bytes":
            #  Includes a NUL and a high byte: neither may be lost on the way up
            #  or back down.
            return self._send(200, bytes([0x00, 0xFF, 0x41, 0x00, 0x42]), content_type="application/octet-stream")
        if path == "/bytes/echo":
            length = int(self.headers.get("Content-Length") or 0)
            payload = self.rfile.read(length)
            return self._send(
                200,
                json.dumps({"length": len(payload), "bytes": list(payload)}).encode(),
            )
        if path == "/status/204":
            return self._send(204, b"")
        return self._send(404, json.dumps({"title": "Not Found", "status": 404}).encode())

    do_GET = _route
    do_POST = _route
    do_PUT = _route
    do_PATCH = _route
    do_DELETE = _route


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"mock server on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
