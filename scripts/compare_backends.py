"""
Compare Python backend (port 8000) vs Go backend (port 8080) responses.

Usage:
    1. Start Python backend:  cd backend && uvicorn app.main:app --port 8000
    2. Start Go backend:      docker compose up backend   (runs on 8080)
    3. Run this script:       python scripts/compare_backends.py

Optional flags:
    --py-port 8000    Python backend port (default 8000)
    --go-port 8080    Go backend port     (default 8080)
    --verbose         Show full diff output for mismatches
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fetch(base: str, path: str, timeout: int = 15) -> tuple[int, Any, float]:
    """Return (status_code, parsed_json_or_None, elapsed_ms)."""
    try:
        t0 = time.perf_counter()
        r = requests.get(f"{base}{path}", timeout=timeout)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        try:
            body = r.json()
        except Exception:
            body = r.text
        return r.status_code, body, elapsed_ms
    except requests.RequestException as e:
        return 0, {"_error": str(e)}, 0.0


def normalise(obj: Any) -> Any:
    """Sort dicts/lists so structural comparison is order-independent."""
    if isinstance(obj, dict):
        return {k: normalise(v) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        normed = [normalise(v) for v in obj]
        # Try sorting for deterministic order; fall back if items aren't comparable
        try:
            return sorted(normed, key=lambda x: json.dumps(x, sort_keys=True, default=str))
        except TypeError:
            return normed
    return obj


def deep_diff(a: Any, b: Any, path: str = "$") -> list[str]:
    """Return a list of human-readable differences."""
    diffs: list[str] = []
    if type(a) != type(b):
        diffs.append(f"{path}: type {type(a).__name__} vs {type(b).__name__}")
        return diffs
    if isinstance(a, dict):
        all_keys = set(a) | set(b)
        for k in sorted(all_keys):
            if k not in a:
                diffs.append(f"{path}.{k}: missing in Python")
            elif k not in b:
                diffs.append(f"{path}.{k}: missing in Go")
            else:
                diffs.extend(deep_diff(a[k], b[k], f"{path}.{k}"))
    elif isinstance(a, list):
        if len(a) != len(b):
            diffs.append(f"{path}: list length {len(a)} vs {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            diffs.extend(deep_diff(x, y, f"{path}[{i}]"))
    else:
        if a != b:
            sa = str(a)[:120]
            sb = str(b)[:120]
            diffs.append(f"{path}: {sa!r} vs {sb!r}")
    return diffs


def pick_sample_ids(base: str) -> dict[str, str]:
    """Fetch a video_id and a ticker symbol from whichever backend responds."""
    ids: dict[str, str] = {}

    # Grab a video_id
    _, body, _ = fetch(base, "/videos?limit=1")
    if isinstance(body, dict):
        data = body.get("data", [])
        if data and isinstance(data, list):
            ids["video_id"] = data[0].get("video_id", "")

    # Grab a ticker symbol from top-movers
    _, body, _ = fetch(base, "/entities/top-movers?limit=1")
    if isinstance(body, dict):
        data = body.get("data", [])
        if data and isinstance(data, list):
            ids["symbol"] = data[0].get("symbol", "")

    return ids


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Python & Go backend responses")
    parser.add_argument("--py-port", type=int, default=8000)
    parser.add_argument("--go-port", type=int, default=8080)
    parser.add_argument("--verbose", action="store_true", help="Show full diff details")
    args = parser.parse_args()

    py_base = f"http://localhost:{args.py_port}"
    go_base = f"http://localhost:{args.go_port}"

    # Smoke-test connectivity
    for label, base in [("Python", py_base), ("Go", go_base)]:
        code, _, _ = fetch(base, "/health")
        if code == 0:
            print(f"ERROR: Cannot reach {label} backend at {base}/health – is it running?")
            sys.exit(1)

    # Discover sample IDs from whichever backend is up
    ids = pick_sample_ids(py_base) or pick_sample_ids(go_base)
    video_id = ids.get("video_id", "")
    symbol = ids.get("symbol", "AAPL")

    # ------------------------------------------------------------------
    # Endpoints to compare
    # ------------------------------------------------------------------
    endpoints: list[tuple[str, str]] = [
        ("Health",                       "/health"),
        ("Daily summaries - latest",     "/daily-summaries/latest"),
        ("Daily summaries - list",       "/daily-summaries?limit=5"),
        ("Videos - list",                "/videos?limit=5"),
        ("Videos - infographic",         "/videos/infographic?days=7&limit=5"),
        ("Entities - top movers",        "/entities/top-movers?limit=5"),
        ("Recommendations - list",       f"/recommendations?limit=5"),
        ("Track (POST)",                 "POST:/track"),
        ("Feedback survey status",       "/feedback-survey/status"),
    ]

    # Dynamic endpoints that need real IDs
    if video_id:
        endpoints.append(("Videos - detail", f"/videos/{video_id}"))
    if symbol:
        endpoints.append(("Entities - chunks", f"/entities/{symbol}/chunks?limit=5"))
        endpoints.append(("Recommendations - overlay", f"/recommendations/overlay?symbol={symbol}&days=30"))

    # ------------------------------------------------------------------
    # Run comparisons
    # ------------------------------------------------------------------
    passed = 0
    failed = 0
    errors = 0
    latency_rows: list[tuple[str, float, float]] = []  # (label, py_ms, go_ms)

    print(f"\nComparing  Python ({py_base})  vs  Go ({go_base})\n")
    print(f"{'Endpoint':<35} {'Py (ms)':>9} {'Go (ms)':>9} {'Diff':>9}  {'Status':>12}  Details")
    print("-" * 110)

    for label, path in endpoints:
        # Handle POST endpoints
        if path.startswith("POST:"):
            actual_path = path[5:]
            try:
                payload = {"path": "/test", "search": "", "referrer": ""}
                t0 = time.perf_counter()
                py_r = requests.post(f"{py_base}{actual_path}", json=payload, timeout=10)
                py_ms = (time.perf_counter() - t0) * 1000
                t0 = time.perf_counter()
                go_r = requests.post(f"{go_base}{actual_path}", json=payload, timeout=10)
                go_ms = (time.perf_counter() - t0) * 1000
                py_code, py_body = py_r.status_code, py_r.json()
                go_code, go_body = go_r.status_code, go_r.json()
            except Exception as e:
                print(f"  {label:<33} {'':>9} {'':>9} {'':>9}  {'ERROR':>12}  {e}")
                errors += 1
                continue
        else:
            py_code, py_body, py_ms = fetch(py_base, path)
            go_code, go_body, go_ms = fetch(go_base, path)

        # Latency diff
        diff_ms = py_ms - go_ms
        diff_str = f"{diff_ms:+.0f}ms"
        latency_rows.append((label, py_ms, go_ms))

        # Compare status codes
        if py_code != go_code:
            print(f"  {label:<33} {py_ms:>8.0f} {go_ms:>8.0f} {diff_str:>9}  {'STATUS DIFF':>12}  Python={py_code} Go={go_code}")
            failed += 1
            continue

        if py_code == 0:
            print(f"  {label:<33} {'':>9} {'':>9} {'':>9}  {'ERROR':>12}  Both unreachable")
            errors += 1
            continue

        # Compare response bodies (normalised)
        py_norm = normalise(py_body)
        go_norm = normalise(go_body)

        if py_norm == go_norm:
            print(f"  {label:<33} {py_ms:>8.0f} {go_ms:>8.0f} {diff_str:>9}  {'MATCH':>12}  {py_code}")
            passed += 1
        else:
            diffs = deep_diff(py_norm, go_norm)
            n = len(diffs)
            print(f"  {label:<33} {py_ms:>8.0f} {go_ms:>8.0f} {diff_str:>9}  {'DIFF':>12}  {py_code}  ({n} difference{'s' if n != 1 else ''})")
            failed += 1
            if args.verbose:
                for d in diffs[:20]:
                    print(f"      {d}")
                if n > 20:
                    print(f"      ... and {n - 20} more")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    total = passed + failed + errors
    print("-" * 110)
    print(f"\n  Total: {total}   Matched: {passed}   Diff: {failed}   Errors: {errors}\n")

    # ------------------------------------------------------------------
    # Latency summary
    # ------------------------------------------------------------------
    if latency_rows:
        py_times = [r[1] for r in latency_rows]
        go_times = [r[2] for r in latency_rows]
        py_avg = sum(py_times) / len(py_times)
        go_avg = sum(go_times) / len(go_times)
        py_total = sum(py_times)
        go_total = sum(go_times)
        speedup = py_avg / go_avg if go_avg > 0 else float("inf")

        print("  Latency Summary")
        print("  " + "-" * 55)
        print(f"  {'':>33} {'Python':>9} {'Go':>9}")
        print(f"  {'Average (ms)':<33} {py_avg:>8.0f} {go_avg:>8.0f}")
        print(f"  {'Total   (ms)':<33} {py_total:>8.0f} {go_total:>8.0f}")
        print(f"  {'Min     (ms)':<33} {min(py_times):>8.0f} {min(go_times):>8.0f}")
        print(f"  {'Max     (ms)':<33} {max(py_times):>8.0f} {max(go_times):>8.0f}")
        print(f"\n  Go is {speedup:.2f}x {'faster' if speedup >= 1 else 'slower'} than Python on average.\n")

    if failed > 0:
        print("  TIP: Re-run with --verbose to see detailed diffs.\n")

    sys.exit(1 if (failed + errors) > 0 else 0)


if __name__ == "__main__":
    main()
