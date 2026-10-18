"""A real HTTP server on a local port, for the transport tests.

Nothing is mocked below the socket: the SDK builds real requests, httpx writes
them to a real connection, and the server records the bytes it received. Each
test installs a `route` that answers.
"""

from __future__ import annotations

import dataclasses
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple, Union
from urllib.parse import urlsplit

import pytest


@dataclasses.dataclass
class Received:
    method: str
    path: str
    query: str
    headers: Dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)


@dataclasses.dataclass
class Reply:
    status: int = 200
    body: Union[bytes, str, Any] = b""
    headers: Sequence[Tuple[str, str]] = ()
    #  Sent one by one with a flush between them, then the connection closes;
    #  a float is a pause in seconds.
    chunks: Optional[Sequence[Union[bytes, float]]] = None

    @classmethod
    def json(cls, value: Any, status: int = 200, headers: Sequence[Tuple[str, str]] = ()) -> "Reply":
        return cls(status, json.dumps(value).encode(), (("Content-Type", "application/json"), *headers))

    @classmethod
    def events(cls, *chunks: Union[bytes, float], status: int = 200) -> "Reply":
        return cls(status, b"", (("Content-Type", "text/event-stream"),), chunks)


Route = Callable[[Received], Reply]


class Server:
    def __init__(self) -> None:
        self.received: List[Received] = []
        self.route: Route = lambda request: Reply(404, b"")
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                pass

            def _handle(self) -> None:
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length) if length else b""
                parts = urlsplit(self.path)
                request = Received(
                    method=self.command,
                    path=parts.path,
                    query=parts.query,
                    headers={key.lower(): value for key, value in self.headers.items()},
                    body=body,
                )
                server.received.append(request)
                reply = server.route(request)
                payload = reply.body if isinstance(reply.body, bytes) else str(reply.body).encode()
                self.send_response(reply.status)
                for name, value in reply.headers:
                    self.send_header(name, value)
                if reply.chunks is None:
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                try:
                    for chunk in reply.chunks:
                        if isinstance(chunk, float):
                            time.sleep(chunk)
                            continue
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

        self._http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._http.daemon_threads = True
        self.url = f"http://127.0.0.1:{self._http.server_address[1]}"
        self._thread = threading.Thread(target=self._http.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._http.shutdown()
        self._http.server_close()


@pytest.fixture
def server() -> Iterator[Server]:
    instance = Server()
    yield instance
    instance.close()


def agent_json(agent_id: str = "a1") -> Dict[str, Any]:
    """A complete `Agent`: the model decodes strictly, so every required field is here."""
    return {
        "agent_id": agent_id,
        "tenant_id": "t1",
        "name": "demo",
        "model": {"provider": "openai_compat", "model_ref": "gpt-x", "capabilities": {}},
        "created_at": "2026-01-01T00:00:00Z",
    }
