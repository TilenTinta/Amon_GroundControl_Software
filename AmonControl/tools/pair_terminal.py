from __future__ import annotations

import argparse
import sys
import time

try:
    import serial
except ImportError as exc:  # pragma: no cover
    raise SystemExit("pyserial is required") from exc


SIG_SOF = 0xAA
PROTOCOL_VER = 0x01
FLAG_DATA = 0x05
FLAG_ACK = 0x01
ID_PC = 0x01
ID_DRONE = 0x20
OPT_PAIR_START = 0x11
OPT_PAIR_STATUS = 0x10


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


def build_frame(opcode: int) -> bytes:
    header = bytes(
        [
            PROTOCOL_VER,
            FLAG_DATA,
            ID_PC,
            ID_DRONE,
            opcode,
            0x00,
        ]
    )
    length = len(header) + 2
    crc_input = bytes([length]) + header
    crc = crc16_cal(crc_input)
    return bytes([SIG_SOF, length]) + header + bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def read_frame(
    ser: serial.Serial,
    timeout_s: float = 1.0,
    buf: bytearray | None = None,
) -> bytes | None:
    if buf is None:
        buf = bytearray()
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        chunk = ser.read(1)
        if chunk:
            buf.extend(chunk)
        else:
            continue
        while len(buf) >= 2:
            if buf[0] != SIG_SOF:
                buf.pop(0)
                continue
            length = buf[1]
            total_len = 2 + length
            if len(buf) < total_len:
                break
            frame = bytes(buf[:total_len])
            del buf[:total_len]
            return frame
    return None


def parse_frame(frame: bytes) -> dict | None:
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
    return {
        "ver": header[0],
        "flags": header[1],
        "src": header[2],
        "dst": header[3],
        "opcode": header[4],
        "plen": payload_len,
    }


def send_and_wait(
    ser: serial.Serial,
    opcode: int,
    *,
    timeout_s: float = 1.0,
    max_retries: int = 3,
) -> bool:
    frame = build_frame(opcode)
    print(f"pairing-tx: {frame.hex()}")
    attempts = 0
    while attempts <= max_retries:
        ser.reset_input_buffer()
        ser.write(frame)
        rx_buf = bytearray()
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            resp = read_frame(ser, timeout_s=remaining, buf=rx_buf)
            if not resp:
                break
            print(f"uart-rx: {resp.hex()}")
            parsed = parse_frame(resp)
            if not parsed:
                print("invalid frame")
                continue
            if parsed["flags"] & FLAG_ACK and parsed["opcode"] == opcode:
                print("ack received")
                return True
        print("timeout waiting for ACK")
        attempts += 1
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Pair drone over UART.")
    parser.add_argument("--port", required=True, help="Serial port (e.g. COM3)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    args = parser.parse_args()

    try:
        ser = serial.Serial(args.port, baudrate=args.baud, timeout=1.0, write_timeout=1.0)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to open {args.port}: {exc}", file=sys.stderr)
        return 1

    print(f"Connected to {args.port} @ {args.baud}")
    try:
        if not send_and_wait(ser, OPT_PAIR_START):
            print("Pairing start failed.", file=sys.stderr)
            return 2
        if not send_and_wait(ser, OPT_PAIR_STATUS):
            print("Pairing status failed.", file=sys.stderr)
            return 2
    finally:
        ser.close()

    print("Pairing complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
