#!/usr/bin/env python3
"""Encode notify endpoint for docs/_notify.js (XOR + base64). Do not commit raw URLs."""
from __future__ import annotations

import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "docs" / "_notify.js"
KEY = 0xA7


def encode(url: str) -> str:
    raw = url.strip().encode("utf-8")
    return base64.b64encode(bytes(b ^ KEY for b in raw)).decode("ascii")


def patch_js(blob: str) -> None:
    text = TARGET.read_text(encoding="utf-8")
    new_text, n = re.subn(
        r'const B =\s*\n\s*"[^"]*";',
        f'const B =\n    "{blob}";',
        text,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"Could not patch blob in {TARGET}")
    TARGET.write_text(new_text, encoding="utf-8")
    print(f"Updated {TARGET}")


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: py encode_notify_endpoint.py <full-endpoint-url>", file=sys.stderr)
        raise SystemExit(2)
    patch_js(encode(sys.argv[1]))


if __name__ == "__main__":
    main()
