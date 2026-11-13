#!/usr/bin/env python3
"""Validate RGB PNG output produced by pinned esp32sim's framebuffer writer."""
import struct
import sys
import zlib
from pathlib import Path


def read_frame(path):
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'{path}: invalid PNG signature')
    offset, encoded, width, height = 8, bytearray(), None, None
    while offset + 12 <= len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        if len(chunk) != length:
            raise ValueError('truncated PNG')
        if kind == b'IHDR':
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', chunk)
            if (width, height, depth, color, compression, filtering, interlace) != (466, 466, 8, 2, 0, 0, 0):
                raise ValueError('unexpected PNG dimensions or format')
        elif kind == b'IDAT':
            encoded.extend(chunk)
        elif kind == b'IEND':
            break
        offset += length + 12
    raw = zlib.decompress(encoded)
    stride = width * 3 + 1
    if len(raw) != stride * height:
        raise ValueError('incorrect image length')
    rows = []
    for y in range(height):
        line = raw[y*stride:(y+1)*stride]
        if line[0] != 0:
            raise ValueError('unexpected PNG scanline filter')
        rows.append(line[1:])
    return rows


def pixel(rows, x, y):
    return tuple(rows[y][x*3:x*3+3])

before, after = map(read_frame, sys.argv[1:3])
for frame in (before, after):
    assert pixel(frame, 0, 0) == (0, 0, 0), 'round display corner not clipped'
    r, g, b = pixel(frame, 200, 263)
    assert b > r + 30 and b > g, 'expected blue firmware-drawn button missing'
changed = sum(a != b for row_a, row_b in zip(before, after) for a, b in zip(row_a, row_b))
assert changed > 50, f'touch did not visibly change the frame ({changed} differing bytes)'
print(f'firmware frames are clipped, contain the LVGL button, and differ after touch ({changed} bytes)')
