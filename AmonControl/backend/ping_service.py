from __future__ import annotations

from .logger import DataLogger
from .protocol import FLAG_ACK, OPT_PING, build_ping_frame, parse_frame
from .serial_comm import SerialManager


def send_ping(serial: SerialManager, logger: DataLogger | None = None) -> dict:
    if not serial.is_connected:
        return {"ok": False, "error": "Not connected"}
    frame = build_ping_frame()
    try:
        serial.reset_input()
        serial.write(frame)
        response = serial.read_frame(timeout_s=1.0)
        if not response:
            return {"ok": False, "error": "Timeout waiting for pong"}
        parsed = parse_frame(response)
        if not parsed:
            return {"ok": False, "error": "Invalid pong frame"}
        if parsed.opcode != OPT_PING:
            return {"ok": False, "error": f"Unexpected opcode {parsed.opcode}"}
        is_ack = bool(parsed.flags & FLAG_ACK)
        if logger:
            logger.log_frame("pong", response)
        return {"ok": True, "pong": True, "ack": is_ack}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
