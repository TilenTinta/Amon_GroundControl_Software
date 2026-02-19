####################################################################
# File Name          : ping_service.py
# Author             : Tinta T.
# Version            : V1.0.0
# Date               : 2026/02/09
# Description        : Send ping and wait for pong response
####################################################################

from __future__ import annotations

from .logger import DataLogger
from .protocol import FLAG_ACK, OPT_PING, build_ping_frame, parse_frame
from .serial_comm import SerialManager


def send_ping(serial: SerialManager, logger: DataLogger | None = None) -> dict:

    # Guard for calling when no serial port is open
    if not serial.is_connected:
        return {"ok": False, "error": "Not connected"}
    

    # Build ping frame
    frame = build_ping_frame()
    try:
        # Clear stale buffer
        serial.reset_input()

        # Send ping frame
        serial.write(frame)

        # Wait for pong response
        response = serial.read_frame(timeout_s=1.0) # Adjust
        if not response:
            return {"ok": False, "error": "Timeout waiting for pong"}

        # Decode response
        parsed = parse_frame(response)
        if not parsed:
            return {"ok": False, "error": "Invalid pong frame"}
        if parsed.opcode != OPT_PING:
            return {"ok": False, "error": f"Unexpected opcode {parsed.opcode}"}

        # Ping replies should have ACK set
        is_ack = bool(parsed.flags & FLAG_ACK)
        if logger:
            logger.log_frame("pong", response)
        return {"ok": True, "pong": True, "ack": is_ack}
    
    except Exception as exc:  # noqa: BLE001
        # Convert any exceptions in simple error payload
        return {"ok": False, "error": str(exc)}
