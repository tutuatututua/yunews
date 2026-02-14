from __future__ import annotations

import json
import logging
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse


logger = logging.getLogger(__name__)


def _is_authorized(*, headers: dict[str, str] | None, query: str) -> bool:
    """Optional shared-secret auth.

    If PIPELINE_CRON_KEY is unset, allow all requests.
    If set, require matching key either via:
    - header: x-pipeline-key
    - query param: ?key=...
    """

    expected = (os.environ.get("PIPELINE_CRON_KEY") or "").strip()
    if not expected:
        return True

    headers = headers or {}
    provided = (headers.get("x-pipeline-key") or "").strip()
    if not provided:
        qs = parse_qs(query or "")
        vals = qs.get("key") or []
        provided = (vals[0] if vals else "").strip()

    return bool(provided) and provided == expected


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self._run()

    def do_POST(self) -> None:  # noqa: N802
        self._run()

    def _run(self) -> None:
        parsed = urlparse(self.path)
        if not _is_authorized(headers={k.lower(): v for k, v in (self.headers or {}).items()}, query=parsed.query):
            self._send(401, {"ok": False, "error": "unauthorized"})
            return

        try:
            # Import lazily so a simple auth failure doesn't import heavy deps.
            from run_daily_pipeline import main as pipeline_main

            pipeline_main()
            self._send(200, {"ok": True})
        except Exception:
            # Never leak exception details in the HTTP response (serverless logs contain the traceback).
            logger.exception("Pipeline execution failed")
            self._send(500, {"ok": False, "error": "pipeline_failed"})
