from __future__ import annotations

from .logger import DataLogger
from .protocol import (
    FLAG_ACK,
    FLAG_DATA,
    ID_DRONE,
    ID_PC,
    OPT_PAIR_START,
    OPT_PAIR_STATUS,
    PROTOCOL_VER,
    build_frame,
    parse_frame,
)
from .serial_comm import SerialManager


def _send_and_wait(
    serial: SerialManager,
    *,
    opcode: int,
    logger: DataLogger | None = None,
    timeout_s: float = 1.0,
) -> dict:
    frame = build_frame(
        version=PROTOCOL_VER,
        flags=FLAG_DATA,
        src=ID_PC,
        dst=ID_DRONE,
        opcode=opcode,
        payload=b"",
    )
    serial.write(frame)
    response = serial.read_frame(timeout_s=timeout_s)
    if not response:
        return {"ok": False, "error": "Timeout waiting for ACK"}
    parsed = parse_frame(response)
    if not parsed:
        return {"ok": False, "error": "Invalid response frame"}
    if parsed.opcode != opcode:
        return {"ok": False, "error": f"Unexpected opcode {parsed.opcode}"}
    if parsed.src != ID_DRONE or parsed.dst != ID_PC:
        return {"ok": False, "error": "Unexpected source/destination"}
    if not (parsed.flags & FLAG_ACK):
        return {"ok": False, "error": "ACK flag not set"}
    if logger:
        logger.log_frame("pairing-ack", response)
    return {"ok": True}


def run_pairing(serial: SerialManager, logger: DataLogger | None = None) -> dict:
    if not serial.is_connected:
        return {"ok": False, "error": "Not connected"}
    try:
        serial.reset_input()
        start = _send_and_wait(serial, opcode=OPT_PAIR_START, logger=logger)
        if not start.get("ok"):
            return start
        status = _send_and_wait(serial, opcode=OPT_PAIR_STATUS, logger=logger)
        if not status.get("ok"):
            return status
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
