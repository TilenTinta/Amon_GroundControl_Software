from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import threading
import time

from backend.logger import DataLogger
from backend.pairing_service import run_pairing
from backend.ping_service import send_ping
from backend.protocol import (
    FLAG_STREAM,
    FLAG_DATA,
    ID_DRONE,
    ID_LINK_SW,
    ID_PC,
    PROTOCOL_VER,
    OPT_TELEMETRY,
    OPT_TELEMETRY_STREAM,
    TVL_ALT,
    TVL_ANGL,
    TVL_BAT_EDF,
    TVL_BAT_MAIN,
    TVL_DATE_TIME,
    TVL_DRONE_MODE,
    TVL_ERR,
    TVL_IMU,
    TVL_IMU_TEMP,
    TVL_RF_FAIL_CNT,
    TVL_RF_STREAM,
    TVL_RF_TX_CNT,
    TVL_THP,
    TVL_TLM,
    parse_frame,
    build_frame,
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
        with state.telemetry_lock:
            state.last_telemetry = _zero_payload()


def _serial() -> SerialManager:
    return state.serial


def _status_label(code: int) -> str:
    labels = {
        0: "Startup",
        1: "Idle",
        2: "Error",
        3: "Arm",
        4: "Fly",
        5: "Fly Over",
        6: "Gyro Calib",
    }
    return labels.get(code, f"Mode {code}")


def _parse_tlv_payload(payload: bytes) -> dict:
    updates: dict = {}
    raw_updates: dict = {}
    battery_main_set = False
    battery_edf_set = False
    angle_scale = 100.0
    idx = 0
    while idx < len(payload):
        tlv = payload[idx]
        idx += 1
        if tlv == TVL_DRONE_MODE:
            if idx + 1 > len(payload):
                break
            status = payload[idx]
            idx += 1
            updates["flight_state"] = _status_label(status)
            updates["mode"] = _status_label(status)
        elif tlv == TVL_ERR:
            if idx + 2 > len(payload):
                break
            err1 = payload[idx]
            err2 = payload[idx + 1]
            idx += 2
            raw_updates["state"] = f"0x{err1:02X}{err2:02X}"
        elif tlv in (TVL_BAT_MAIN, TVL_BAT_EDF):
            if idx + 2 > len(payload):
                break
            batt_raw = (payload[idx] << 8) | payload[idx + 1]
            idx += 2
            batt_v = _decode_battery_v(batt_raw)
            if not battery_main_set:
                battery_main_set = True
                updates["battery_main_v"] = batt_v
                updates["battery_v"] = batt_v
                raw_updates["bAt"] = batt_v
            else:
                battery_edf_set = True
                updates["battery_motor_v"] = batt_v
                raw_updates["bAt2"] = batt_v
        elif tlv == TVL_DATE_TIME:
            if idx + 6 > len(payload):
                break
            year = payload[idx]
            month = payload[idx + 1]
            day = payload[idx + 2]
            hour = payload[idx + 3]
            minutes = payload[idx + 4]
            seconds = payload[idx + 5]
            idx += 6
            raw_updates["tN"] = f"{year:02d}-{month:02d}-{day:02d}"
            raw_updates["tM"] = f"{hour:02d}:{minutes:02d}:{seconds:02d}"
        elif tlv == TVL_RF_STREAM:
            if idx + 1 > len(payload):
                break
            raw_updates["fP"] = payload[idx]
            idx += 1
        elif tlv == TVL_RF_TX_CNT:
            if idx + 4 > len(payload):
                break
            tx_cnt = (
                (payload[idx] << 24)
                | (payload[idx + 1] << 16)
                | (payload[idx + 2] << 8)
                | payload[idx + 3]
            )
            idx += 4
            updates["link_quality"] = tx_cnt
        elif tlv == TVL_RF_FAIL_CNT:
            if idx + 4 > len(payload):
                break
            fail_cnt = (
                (payload[idx] << 24)
                | (payload[idx + 1] << 16)
                | (payload[idx + 2] << 8)
                | payload[idx + 3]
            )
            idx += 4
            updates["packet_loss"] = fail_cnt
        elif tlv == TVL_THP:
            if idx + 7 > len(payload):
                break
            temp_raw = _signed16((payload[idx] << 8) | payload[idx + 1])
            humidity = payload[idx + 2]
            pressure_raw = (
                (payload[idx + 3] << 24)
                | (payload[idx + 4] << 16)
                | (payload[idx + 5] << 8)
                | payload[idx + 6]
            )
            idx += 7
            baro_alt_raw = None
            if idx + 2 <= len(payload):
                baro_alt_raw = (payload[idx] << 8) | payload[idx + 1]
                idx += 2
            updates["temperature_c"] = temp_raw / 100.0
            updates["humidity_pct"] = humidity
            updates["pressure_hpa"] = pressure_raw / 100.0
            if baro_alt_raw is not None:
                updates["baro_alt"] = baro_alt_raw
            raw_updates["tP"] = temp_raw / 100.0
            raw_updates["hum"] = humidity
            raw_updates["bPs"] = pressure_raw / 100.0
        elif tlv == TVL_TLM:
            if idx + 1 > len(payload):
                break
            updates["tlm_rate"] = payload[idx]
            idx += 1
        elif tlv == TVL_ANGL:
            if idx + 6 > len(payload):
                break
            roll = (payload[idx] << 8) | payload[idx + 1]
            pitch = (payload[idx + 2] << 8) | payload[idx + 3]
            yaw = (payload[idx + 4] << 8) | payload[idx + 5]
            idx += 6
            updates["orientation"] = {
                "roll": _signed16(roll) / angle_scale,
                "pitch": _signed16(pitch) / angle_scale,
                "yaw": _signed16(yaw) / angle_scale,
            }
        elif tlv == TVL_ALT:
            if idx + 2 > len(payload):
                break
            alt_cm = (payload[idx] << 8) | payload[idx + 1]
            idx += 2
            updates["baro_alt"] = alt_cm / 100.0
        elif tlv == TVL_IMU:
            if idx + 12 > len(payload):
                break
            ax = _signed16((payload[idx] << 8) | payload[idx + 1])
            ay = _signed16((payload[idx + 2] << 8) | payload[idx + 3])
            az = _signed16((payload[idx + 4] << 8) | payload[idx + 5])
            gx = _signed16((payload[idx + 6] << 8) | payload[idx + 7])
            gy = _signed16((payload[idx + 8] << 8) | payload[idx + 9])
            gz = _signed16((payload[idx + 10] << 8) | payload[idx + 11])
            idx += 12
            updates["accel"] = {
                "ax": ax / angle_scale,
                "ay": ay / angle_scale,
                "az": az / angle_scale,
            }
            updates["gyro"] = {
                "gx": gx / angle_scale,
                "gy": gy / angle_scale,
                "gz": gz / angle_scale,
            }
        elif tlv == TVL_IMU_TEMP:
            if idx + 2 > len(payload):
                break
            imu_temp = _signed16((payload[idx] << 8) | payload[idx + 1])
            idx += 2
            updates["imu_temp"] = imu_temp / angle_scale
        else:
            break
    if raw_updates:
        updates["raw"] = raw_updates
    return updates


def _signed16(value: int) -> int:
    return value - 0x10000 if value & 0x8000 else value


def _decode_battery_v(raw: int) -> float:
    if raw < 2000:
        return raw / 100.0
    return raw / 1000.0


def _apply_telemetry(decoded: dict) -> None:
    if not decoded:
        return
    with state.telemetry_lock:
        payload = state.last_telemetry or _zero_payload()
        raw_updates = decoded.get("raw")
        updates = dict(decoded)
        updates.pop("raw", None)
        payload.update(updates)
        now = time.monotonic()
        if state.last_tlm_ts:
            dt = now - state.last_tlm_ts
            if dt > 0:
                rate = 1.0 / dt
                state.tlm_rate_hz = (
                    rate if state.tlm_rate_hz == 0 else (state.tlm_rate_hz * 0.8 + rate * 0.2)
                )
        state.last_tlm_ts = now
        payload["tlm_rate"] = state.tlm_rate_hz
        if raw_updates:
            payload.setdefault("raw", {})
            payload["raw"].update(raw_updates)
        state.last_telemetry = payload


def _telemetry_worker() -> None:
    rx_buf = bytearray()
    while True:
        if not _serial().is_connected or state.telemetry_paused:
            time.sleep(0.05)
            continue
        frame = _serial().read_frame(timeout_s=0.1, buf=rx_buf)
        if not frame:
            continue
        parsed = parse_frame(frame)
        if not parsed:
            continue
        if parsed.flags != FLAG_STREAM or parsed.opcode != OPT_TELEMETRY:
            continue
        if parsed.src != ID_DRONE or parsed.dst != ID_PC:
            continue
        decoded = _parse_tlv_payload(parsed.payload)
        _apply_telemetry(decoded)


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
        with state.telemetry_lock:
            state.last_telemetry = _zero_payload()
        try:
            stream_off = build_frame(
                version=PROTOCOL_VER,
                flags=FLAG_DATA,
                src=ID_PC,
                dst=ID_LINK_SW,
                opcode=OPT_TELEMETRY_STREAM,
                payload=bytes([0x00]),
            )
            _serial().write(stream_off)
            logger.log_frame("telemetry-stream-off", stream_off)
        except Exception as exc:  # noqa: BLE001
            logger.log_event(f"Stream off command failed: {exc}")
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
    with state.telemetry_lock:
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
    with state.telemetry_lock:
        return state.last_telemetry or _zero_payload()


@app.on_event("startup")
def _start_telemetry_thread() -> None:
    thread = threading.Thread(target=_telemetry_worker, daemon=True)
    thread.start()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend_server:app", host="127.0.0.1", port=8002, log_level="info")
