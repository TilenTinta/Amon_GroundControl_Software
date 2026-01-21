from __future__ import annotations

from .logger import DataLogger
from .protocol import (
    FLAG_ACK,
    FLAG_DATA,
    ID_DRONE,
    ID_PC,
    OPT_ERROR_TX,
    OPT_PAIR_START,
    OPT_PAIR_STATUS,
    PROTOCOL_VER,
    build_frame,
    parse_frame,
)
from .serial_comm import SerialManager
from .state import LinkState


def _send_and_wait(
    serial: SerialManager,
    state: LinkState,
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
    attempts = 0
    while attempts <= state.max_retransmits:
        serial.write(frame)
        response = serial.read_frame(timeout_s=timeout_s)
        if not response:
            return {"ok": False, "error": "Timeout waiting for ACK"}
        parsed = parse_frame(response)
        if not parsed:
            return {"ok": False, "error": "Invalid response frame"}
        if parsed.flags & FLAG_ACK and parsed.opcode == opcode:
            if parsed.src != ID_DRONE or parsed.dst != ID_PC:
                return {"ok": False, "error": "Unexpected source/destination"}
            state.error_tx_streak = 0
            if logger:
                logger.log_frame("pairing-ack", response)
            return {"ok": True}
        if parsed.flags & FLAG_ERR and parsed.opcode == OPT_ERROR_TX:
            state.error_tx_count += 1
            state.error_tx_streak += 1
            attempts += 1
            if state.error_tx_streak > state.max_retransmits:
                return {"ok": False, "error": "Drone connection lost"}
            continue
        return {"ok": False, "error": f"Unexpected opcode {parsed.opcode}"}
    return {"ok": False, "error": "Drone connection lost"}


def run_pairing(
    serial: SerialManager,
    state: LinkState,
    logger: DataLogger | None = None,
) -> dict:
    if not serial.is_connected:
        return {"ok": False, "error": "Not connected"}
    try:
        serial.reset_input()
        state.error_tx_streak = 0
        start = _send_and_wait(serial, state, opcode=OPT_PAIR_START, logger=logger)
        if not start.get("ok"):
            return start
        status = _send_and_wait(serial, state, opcode=OPT_PAIR_STATUS, logger=logger)
        if not status.get("ok"):
            return status
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
