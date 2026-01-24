from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.logger import DataLogger
from backend.pairing_service import run_pairing
from backend.ping_service import send_ping
from backend.protocol import (
    FLAG_STREAM,
    ID_DRONE,
    ID_PC,
    OPT_TELEMETRY,
    TVL_THP,
    parse_frame,
)
from backend.serial_comm import SerialManager
from backend.state import LinkState

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectRequest(BaseModel):
    port: str
    baud_rate: int


state = LinkState()
logger = DataLogger()


def _zero_payload() -> dict:
    return {
        "flight_state": "Idle",
        "battery_v": 0,
        "battery_main_v": 0,
        "battery_motor_v": 0,
        "signal_dbm": 0,
        "tlm_rate": 0,
        "gps_sat": 0,
        "imu_temp": 0,
        "baro_alt": 0,
        "temperature_c": 0,
        "humidity_pct": 0,
        "pressure_hpa": 0,
        "orientation": {"roll": 0, "pitch": 0, "yaw": 0},
        "velocity": {"vx": 0, "vy": 0, "vz": 0},
        "position": {"x": 0, "y": 0, "z": 0},
        "accel": {"ax": 0, "ay": 0, "az": 0},
        "gyro": {"gx": 0, "gy": 0, "gz": 0},
        "throttle": 0,
        "tvc": {"x": 0, "y": 0, "z": 0},
        "link_quality": 0,
        "link_latency": 0,
        "packet_loss": 0,
        "mode": "-",
        "raw": {
            "bPs": 0,
            "tP": 0,
            "hum": 0,
            "bAt": 0,
            "bAt2": 0,
        },
    }


state.last_telemetry = _zero_payload()


def _connection_status() -> str:
    return f"Connected to {state.port}" if state.port else "Disconnected"

def _sync_connection_state() -> None:
    if not _serial().check_connection():
        state.port = ""
        state.baud_rate = 0
        state.error_tx_streak = 0
        state.drone_connected = False
        state.last_telemetry = _zero_payload()


def _serial() -> SerialManager:
    return state.serial


def _decode_thp_payload(payload: bytes) -> dict | None:
    if len(payload) < 12 or payload[0] != TVL_THP:
        return None
    temp_raw = (payload[1] << 8) | payload[2]
    humidity = payload[3]
    pressure_raw = (
        (payload[4] << 24)
        | (payload[5] << 16)
        | (payload[6] << 8)
        | payload[7]
    )
    batt_main_raw = (payload[8] << 8) | payload[9]
    batt_motor_raw = (payload[10] << 8) | payload[11]
    return {
        "temperature_c": temp_raw / 100.0,
        "humidity_pct": humidity,
        "pressure_hpa": pressure_raw / 100.0,
        "battery_v": batt_main_raw / 1000.0,
        "battery_main_v": batt_main_raw / 1000.0,
        "battery_motor_v": batt_motor_raw / 1000.0,
        "raw": {
            "bPs": pressure_raw / 100.0,
            "tP": temp_raw / 100.0,
            "hum": humidity,
            "bAt": batt_main_raw / 1000.0,
            "bAt2": batt_motor_raw / 1000.0,
        },
    }


def _read_latest_telemetry() -> None:
    if not _serial().is_connected:
        return
    rx_buf = bytearray()
    while True:
        frame = _serial().read_frame(timeout_s=0.05, buf=rx_buf)
        if not frame:
            break
        parsed = parse_frame(frame)
        if not parsed:
            continue
        if parsed.flags != FLAG_STREAM or parsed.opcode != OPT_TELEMETRY:
            continue
        if parsed.src != ID_DRONE or parsed.dst != ID_PC:
            continue
        decoded = _decode_thp_payload(parsed.payload)
        if not decoded:
            continue
        payload = _zero_payload()
        payload.update(decoded)
        payload["raw"].update(decoded.get("raw", {}))
        state.last_telemetry = payload


@app.get("/status")
def status() -> dict:
    _sync_connection_state()
    return {
        "ok": True,
        "connection_status": _connection_status(),
        "connection_port": state.port,
        "drone_connected": state.drone_connected,
    }


@app.get("/ports")
def ports() -> dict:
    error = None
    if not _serial().available:
        error = "pyserial not installed"
    _sync_connection_state()
    return {
        "ports": _serial().list_ports(),
        "connection_port": state.port,
        "connection_status": _connection_status(),
        "error": error,
    }


@app.post("/connect")
def connect(request: ConnectRequest) -> dict:
    error = None
    if not _serial().available:
        error = "pyserial not installed"
        return {
            "connection_port": state.port,
            "connection_status": _connection_status(),
            "error": error,
        }
    try:
        _serial().connect(request.port, request.baud_rate)
        state.port = request.port
        state.baud_rate = request.baud_rate
        state.error_tx_streak = 0
        state.drone_connected = False
        state.last_telemetry = _zero_payload()
        logger.log_event(f"Connected to {state.port}")
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
        _serial().disconnect()
        state.port = ""
        state.baud_rate = 0
    return {
        "connection_port": state.port,
        "connection_status": _connection_status(),
        "error": error,
    }


@app.post("/disconnect")
def disconnect() -> dict:
    _serial().disconnect()
    state.port = ""
    state.baud_rate = 0
    state.error_tx_streak = 0
    state.drone_connected = False
    state.last_telemetry = _zero_payload()
    logger.log_event("Disconnected")
    return {
        "connection_port": state.port,
        "connection_status": _connection_status(),
    }


@app.post("/ping")
def ping() -> dict:
    _sync_connection_state()
    return send_ping(_serial(), logger)


@app.post("/pair")
def pair() -> dict:
    return run_pairing(_serial(), state, logger)


@app.get("/pair_config")
def pair_config() -> dict:
    return {
        "max_retransmits": state.max_retransmits,
        "require_status_ack": state.require_status_ack,
    }


@app.post("/pair_config")
def update_pair_config(payload: dict) -> dict:
    value = payload.get("max_retransmits")
    if isinstance(value, int):
        state.max_retransmits = max(0, min(10, value))
    require_status_ack = payload.get("require_status_ack")
    if isinstance(require_status_ack, bool):
        state.require_status_ack = require_status_ack
    state.save_config()
    return {
        "max_retransmits": state.max_retransmits,
        "require_status_ack": state.require_status_ack,
    }


@app.get("/pair_stats")
def pair_stats() -> dict:
    return {
        "error_tx_count": state.error_tx_count,
        "error_tx_streak": state.error_tx_streak,
    }


@app.get("/telemetry")
def telemetry(drone: str = "amon") -> dict:
    _ = drone
    _read_latest_telemetry()
    return state.last_telemetry or _zero_payload()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend_server:app", host="127.0.0.1", port=8002, log_level="info")
