from __future__ import annotations

from dataclasses import dataclass

SIG_SOF = 0xAA
PROTOCOL_VER = 0x01

ID_PC = 0x01
ID_LINK_SW = 0x11
ID_DRONE = 0x20

FLAG_DATA = 0x05
FLAG_ACK = 0x01

OPT_PING = 0x01


def crc16_cal(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc >>= 1
                crc ^= 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF


def build_frame(
    *,
    version: int,
    flags: int,
    src: int,
    dst: int,
    opcode: int,
    payload: bytes = b"",
) -> bytes:
    header = bytes(
        [
            version,
            flags,
            src,
            dst,
            opcode,
            len(payload),
        ]
    )
    length = len(header) + len(payload) + 2
    crc_input = bytes([length]) + header + payload
    crc = crc16_cal(crc_input)
    crc_lo = crc & 0xFF
    crc_hi = (crc >> 8) & 0xFF
    return bytes([SIG_SOF, length]) + header + payload + bytes([crc_lo, crc_hi])


def build_ping_frame() -> bytes:
    return build_frame(
        version=PROTOCOL_VER,
        flags=FLAG_DATA,
        src=ID_PC,
        dst=ID_DRONE,
        opcode=OPT_PING,
        payload=b"",
    )


@dataclass
class ParsedFrame:
    version: int
    flags: int
    src: int
    dst: int
    opcode: int
    payload: bytes


def parse_frame(frame: bytes) -> ParsedFrame | None:
    if len(frame) < 10 or frame[0] != SIG_SOF:
        return None
    length = frame[1]
    if len(frame) != 2 + length:
        return None
    crc_recv = frame[-2] | (frame[-1] << 8)
    crc_calc = crc16_cal(frame[1:-2])
    if crc_recv != crc_calc:
        return None
    header = frame[2:8]
    payload_len = header[5]
    if payload_len != length - 8:
        return None
    payload = frame[8 : 8 + payload_len]
    return ParsedFrame(
        version=header[0],
        flags=header[1],
        src=header[2],
        dst=header[3],
        opcode=header[4],
        payload=payload,
    )
