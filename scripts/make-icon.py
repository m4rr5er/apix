#!/usr/bin/env python3
"""Generate APIX's source icon (app-icon.png).

A rounded dark tile with an amber apex mark. Rendered with flat fills at full
resolution; `npm run icon` (Tauri's icon generator) resamples it into every
size the bundle needs, which is where the antialiasing happens.

Usage:
    python scripts/make-icon.py [output.png]
"""

from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024
BG = (0x14, 0x18, 0x1C)
FG = (0xF0, 0x88, 0x3E)
CORNER_RATIO = 0.22

APEX = (0.500 * SIZE, 0.235 * SIZE)
BASE_LEFT = (0.195 * SIZE, 0.775 * SIZE)
BASE_RIGHT = (0.805 * SIZE, 0.775 * SIZE)


def build_pixels() -> bytearray:
    buf = bytearray(SIZE * SIZE * 4)  # RGBA, all zero (transparent)
    radius = CORNER_RATIO * SIZE

    def fill_row(y: int, x0: float, x1: float, color: tuple[int, int, int]) -> None:
        left = max(0, int(math.ceil(x0)))
        right = min(SIZE, int(math.ceil(x1)))
        if right <= left:
            return
        r, g, b = color
        start = (y * SIZE + left) * 4
        end = (y * SIZE + right) * 4
        buf[start:end] = bytes((r, g, b, 255)) * (right - left)

    # Rounded tile.
    for y in range(SIZE):
        v = y + 0.5
        if v < radius:
            dy = radius - v
            dx = math.sqrt(max(0.0, radius * radius - dy * dy))
            fill_row(y, radius - dx, SIZE - radius + dx, BG)
        elif v > SIZE - radius:
            dy = v - (SIZE - radius)
            dx = math.sqrt(max(0.0, radius * radius - dy * dy))
            fill_row(y, radius - dx, SIZE - radius + dx, BG)
        else:
            fill_row(y, 0.0, float(SIZE), BG)

    # Apex mark.
    top, bottom = APEX[1], BASE_LEFT[1]
    for y in range(int(top), int(bottom) + 1):
        v = y + 0.5
        if v < top or v > bottom:
            continue
        t = (v - top) / (bottom - top)
        left = APEX[0] + (BASE_LEFT[0] - APEX[0]) * t
        right = APEX[0] + (BASE_RIGHT[0] - APEX[0]) * t
        fill_row(y, left, right, FG)

    return buf


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(buf: bytearray) -> bytes:
    raw = bytearray()
    stride = SIZE * 4
    for y in range(SIZE):
        raw.append(0)  # filter type: none
        raw += buf[y * stride : (y + 1) * stride]

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("app-icon.png")
    target.write_bytes(encode_png(build_pixels()))
    print(f"wrote {target} ({target.stat().st_size} bytes, {SIZE}x{SIZE})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
