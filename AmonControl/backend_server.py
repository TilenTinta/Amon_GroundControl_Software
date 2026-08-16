####################################################################
# File Name          : backend_server.py
# Author             : Tinta T.
# Version            : V1.0.0
# Date               : 2026/02/09
# Description        : FastAPI backend for Ground Control
####################################################################

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import csv
import json
import math
from pathlib import Path
import struct
import threading
import time

from backend.logger import DataLogger
from backend.pairing_service import run_pairing
from backend.ping_service import send_ping
from backend.protocol import (
    FLAG_ACK,
    FLAG_STREAM,
    FLAG_DATA,
    ID_DRONE,
    ID_LINK_SW,
    ID_PC,
    PROTOCOL_VER,
    OPT_DRONE_FLIGHT_PATH,
    OPT_DRONE_SET_STATE,
    OPT_DRONE_FPATH_CLEAR,
    OPT_E_KILL,
    OPT_LAND_NOW,
    OPT_LOG_DUMP,
    OPT_LOG_RM,
    OPT_ZERO_COMPAS,
    OPT_TELEMETRY,
    OPT_TELEMETRY_STREAM,
    TVL_ALT,
    TVL_ANGL,
    TVL_BAT_EDF,
    TVL_BAT_MAIN,
    TVL_DATE_TIME,
    TVL_DRONE_MODE,
    TVL_DRONE_POS,
    TVL_DRONE_VEL,
    TVL_ERR,
    TVL_FLIGHT_COM,
    TVL_FLIGHT_MODE,
    TVL_IMU,
    TVL_IMU_TEMP,
    TVL_RF_FAIL_CNT,
    TVL_RF_STREAM,
    TVL_RF_TX_CNT,
    TVL_SOLVE_TIME,
    TVL_THP,
    TVL_TLM,
    TVL_THROTTLE,
    TVL_SERVO_ANGL,
    TVL_STATE_IDLE,
    TVL_STATE_ARM,
    TVL_STATE_FLY,
    TVL_STATE_FLY_OVER,
    parse_frame,
    build_frame,
)
from backend.serial_comm import SerialManager
from backend.state import LinkState


# FastAPI app and CORS setup for renderer access
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


class LogDumpRequest(BaseModel):
    output_path: str


class FlightPathCommand(BaseModel):
    command: str
    data: dict = {}


class FlightPathRequest(BaseModel):
    commands: list[FlightPathCommand] = []


class FtdiLogDumpRequest(BaseModel):
    output_path: str


# Global state and logger shared across endpoints
state = LinkState()
logger = DataLogger()
ftdi_serial = SerialManager()
ftdi_port = ""
ftdi_baud_rate = 0
TX_RETRY_DELAY_S = 0.1
STATE_CONFIRM_TIMEOUT_S = 0.25
LOG_SCHEMA_PATH = Path(__file__).resolve().parent / "backend" / "log_schema.json"
LOG_TYPE_FORMATS = {
    "u8": "B",
    "i8": "b",
    "u16": "H",
    "i16": "h",
    "u32": "I",
    "i32": "i",
    "float": "f",
    "f32": "f",
}


def _load_log_schema() -> tuple[struct.Struct, list[str]]:
    schema = json.loads(LOG_SCHEMA_PATH.read_text(encoding="utf-8"))
    byte_order = schema.get("byte_order", "<")
    fmt_parts = [byte_order]
    headers = []

    for field in schema.get("fields", []):
        field_type = field.get("type")
        if field_type == "pad":
            size = int(field.get("size", 1))
            fmt_parts.append(f"{size}x" if size > 1 else "x")
            continue

        fmt = LOG_TYPE_FORMATS.get(field_type)
        if not fmt:
            raise ValueError(f"Unsupported log field type: {field_type}")
        fmt_parts.append(fmt)
        if field.get("csv", True):
            headers.append(str(field["name"]))

    return struct.Struct("".join(fmt_parts)), headers


LOG_RECORD_STRUCT, LOG_CSV_HEADERS = _load_log_schema()
LOG_DUMP_MAX_DURATION_S = 120.0


def _log_record_dict(record: tuple) -> dict:
    return dict(zip(LOG_CSV_HEADERS, record))


def _log_value_in_range(row: dict, key: str, minimum: float, maximum: float) -> bool:
    value = row.get(key)
    return value is None or (
        isinstance(value, (int, float))
        and math.isfinite(float(value))
        and minimum <= float(value) <= maximum
    )


def _is_valid_log_record(record: tuple) -> bool:
    row = _log_record_dict(record)
    if not _log_value_in_range(row, "timestamp", 0, 0xFFFFFFFF):
        return False
    checks = (
        ("servo_xp", -180, 180),
        ("servo_xn", -180, 180),
        ("servo_yp", -180, 180),
        ("servo_yn", -180, 180),
        ("nmpc_solver_time", 0, 1000000),
        ("nmpc_solve_status", -10000, 10000),
        ("nmpc_last_qp_iter", -10000, 10000),
        ("nmpc_last_qp_status", -10000, 10000),
        ("heading_deg", -360, 360),
        ("pitch", -360, 360),
        ("roll", -360, 360),
        ("yaw", -360, 360),
        ("accel_x", -50, 50),
        ("accel_y", -50, 50),
        ("accel_z", -50, 50),
        ("gyro_x", -5000, 5000),
        ("gyro_y", -5000, 5000),
        ("gyro_z", -5000, 5000),
        ("quaternion_w", -1.1, 1.1),
        ("quaternion_x", -1.1, 1.1),
        ("quaternion_y", -1.1, 1.1),
        ("quaternion_z", -1.1, 1.1),
        ("height_tof_m_filtered", 0, 1000),
        ("height_tof_mm", 0, 100000),
        ("height_baro_m", 0, 10000),
        ("battery_main_voltage", 0, 100000),
        ("battery_edf_voltage", 0, 100000),
        ("temperature", 0, 10000),
        ("pressure", 30000, 120000),
        ("humidity", 0, 100),
        ("edf_percent", 0, 100),
    )
    return all(_log_value_in_range(row, key, minimum, maximum) for key, minimum, maximum in checks)


def _is_continuous_log_record(previous: tuple | None, current: tuple) -> bool:
    if previous is None:
        return True
    previous_ts = _log_record_dict(previous).get("timestamp")
    current_ts = _log_record_dict(current).get("timestamp")
    if not isinstance(previous_ts, (int, float)) or not isinstance(current_ts, (int, float)):
        return False
    delta = float(current_ts) - float(previous_ts)
    return 0 < delta <= 1000


def _zero_payload() -> dict:
    # Baseline telemetry payload for UI when no data is available
    return {
        "flight_state": "Idle",
        "battery_v": 0,
        "battery_main_v": 0,
        "battery_motor_v": 0,
        "signal_dbm": 0,
        "tlm_rate": 0,
        "gps_sat": 0,
        "imu_temp": 0,
        "solve_time_us": 0,
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
        "tvc": {"xp": 0, "xn": 0, "yp": 0, "yn": 0},
        "link_quality": 0,
        "link_latency": 0,
        "packet_loss": 0,
        "mode": "-",
        "flight_phase": "-",
        "flight_command": "-",
        "_telemetry_seq": 0,
        "raw": {
            "bPs": 0,
            "tP": 0,
            "hum": 0,
            "bAt": 0,
            "bAt2": 0,
            "imu_temp": 0,
        },
    }


state.last_telemetry = _zero_payload()


# Connect status for Link device
def _connection_status() -> str:
    return f"Connected to {state.port}" if state.port else "Disconnected"


# Connection state in sync with current serial connection
def _sync_connection_state() -> None:
    if not _serial().check_connection():
        state.port = ""
        state.baud_rate = 0
        state.error_tx_streak = 0
        state.drone_connected = False
        state.telemetry_seq = 0
        with state.telemetry_lock:
            state.last_telemetry = _zero_payload()


# Helper to access the serial manager
def _serial() -> SerialManager:
    return state.serial


def _ftdi_is_connected() -> bool:
    return ftdi_serial.check_connection()


def _decode_log_records(raw: bytes) -> tuple[list[tuple], int]:
    rec_size = LOG_RECORD_STRUCT.size
    total = len(raw) // rec_size
    valid = raw[: total * rec_size]
    records = []
    ignored_records = 0
    for idx in range(total):
        start = idx * rec_size
        end = start + rec_size
        record = LOG_RECORD_STRUCT.unpack(valid[start:end])
        previous = records[-1] if records else None
        if not _is_valid_log_record(record) or not _is_continuous_log_record(previous, record):
            if records:
                ignored_records = total - idx
                break
            continue
        records.append(record)
    leftover = len(raw) - len(valid)
    return records, leftover + (ignored_records * rec_size)


def _write_log_csv(path_text: str, records: list[tuple]) -> Path:
    out_path = Path(path_text).expanduser()
    if not out_path.is_absolute():
        out_path = Path.cwd() / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(LOG_CSV_HEADERS)
        writer.writerows(records)
    return out_path


def _send_drone_state(state_code: int) -> dict:
    _sync_connection_state()
    if not _serial().is_connected:
        return {"ok": False, "error": "Not connected"}
    state_nibble = state_code & 0x0F

    def _telemetry_has_state(payload: bytes, expected_state_nibble: int) -> bool:
        idx = 0
        while idx < len(payload):
            tlv = payload[idx]
            idx += 1
            if tlv == TVL_DRONE_MODE:
                if idx >= len(payload):
                    return False
                mode = payload[idx]
                return (mode & 0x0F) == expected_state_nibble
            if tlv in (TVL_RF_STREAM, TVL_TLM, TVL_THROTTLE, TVL_FLIGHT_MODE, TVL_FLIGHT_COM):
                idx += 1
            elif tlv in (
                TVL_BAT_MAIN,
                TVL_BAT_EDF,
                TVL_ERR,
                TVL_ALT,
                TVL_IMU_TEMP,
            ):
                idx += 2
            elif tlv == TVL_SOLVE_TIME:
                idx += 4
            elif tlv == TVL_DATE_TIME:
                idx += 6
            elif tlv in (TVL_RF_TX_CNT, TVL_RF_FAIL_CNT):
                idx += 4
            elif tlv == TVL_THP:
                # temp(2) + hum(1) + pressure(4) + optional baro_alt(2)
                if idx + 7 > len(payload):
                    return False
                idx += 7
                if idx + 2 <= len(payload):
                    idx += 2
            elif tlv in (TVL_ANGL, TVL_DRONE_POS, TVL_DRONE_VEL):
                idx += 6
            elif tlv == TVL_SERVO_ANGL:
                idx += 8
            elif tlv == TVL_IMU:
                idx += 12
            else:
                return False
            if idx > len(payload):
                return False
        return False

    try:
        state.telemetry_paused = True
        frame = build_frame(
            version=PROTOCOL_VER,
            flags=FLAG_DATA,
            src=ID_PC,
            dst=ID_DRONE,
            opcode=OPT_DRONE_SET_STATE,
            payload=bytes([state_nibble]),
        )
        send_count = max(1, state.max_retransmits + 1)
        rx_buf = bytearray()
        for attempt in range(send_count):
            _serial().write(frame)
            logger.log_frame("drone-state-tx", frame)
            deadline = time.monotonic() + STATE_CONFIRM_TIMEOUT_S
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                response = _serial().read_frame(timeout_s=remaining, buf=rx_buf)
                if not response:
                    break
                parsed = parse_frame(response)
                if not parsed:
                    continue
                ack_ok = (
                    (parsed.flags & FLAG_ACK)
                    and parsed.opcode == OPT_DRONE_SET_STATE
                    and parsed.src == ID_DRONE
                    and parsed.dst == ID_PC
                )
                telemetry_ok = (
                    parsed.opcode == OPT_TELEMETRY
                    and parsed.src == ID_DRONE
                    and parsed.dst == ID_PC
                    and (parsed.flags == FLAG_STREAM or parsed.flags == FLAG_DATA)
                    and _telemetry_has_state(parsed.payload, state_nibble)
                )
                if ack_ok or telemetry_ok:
                    logger.log_event(
                        "State change confirmed by ACK"
                        if ack_ok
                        else "State change confirmed by telemetry"
                    )
                    return {"ok": True, "tx_count": attempt + 1}
            if attempt < send_count - 1:
                time.sleep(TX_RETRY_DELAY_S)
        return {"ok": False, "error": "State change not confirmed", "tx_count": send_count}
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"State command failed: {exc}")
        return {"ok": False, "error": str(exc)}
    finally:
        state.telemetry_paused = False


def _send_drone_fpath_clear() -> dict:
    _sync_connection_state()
    if not _serial().is_connected:
        return {"ok": False, "error": "Not connected"}

    try:
        state.telemetry_paused = True
        frame = build_frame(
            version=PROTOCOL_VER,
            flags=FLAG_DATA,
            src=ID_PC,
            dst=ID_DRONE,
            opcode=OPT_DRONE_FPATH_CLEAR,
            payload=b"",
        )

        # Per requirement: retry up to 10 times and wait for ACK
        send_count = 10
        rx_buf = bytearray()
        for attempt in range(send_count):
            _serial().write(frame)
            logger.log_frame("drone-fpath-clear-tx", frame)

            deadline = time.monotonic() + STATE_CONFIRM_TIMEOUT_S
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                response = _serial().read_frame(timeout_s=remaining, buf=rx_buf)
                if not response:
                    break
                parsed = parse_frame(response)
                if not parsed:
                    continue
                ack_ok = (
                    (parsed.flags & FLAG_ACK)
                    and parsed.opcode == OPT_DRONE_FPATH_CLEAR
                    and parsed.src == ID_DRONE
                    and parsed.dst == ID_PC
                    and parsed.payload == b""
                )
                if ack_ok:
                    return {"ok": True, "tx_count": attempt + 1}

            if attempt < send_count - 1:
                time.sleep(TX_RETRY_DELAY_S)
        return {
            "ok": False,
            "error": "Clear path not confirmed",
            "attempts": send_count,
            "tx_count": send_count,
        }
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"FPATH clear failed: {exc}")
        return {"ok": False, "error": str(exc)}
    finally:
        state.telemetry_paused = False


def _send_drone_opcode_command(
    opcode: int,
    label: str,
    send_count: int = 30,
    retry_interval_s: float = TX_RETRY_DELAY_S,
) -> dict:
    _sync_connection_state()
    if not _serial().is_connected:
        return {"ok": False, "error": "Not connected"}

    try:
        state.telemetry_paused = True
        frame = build_frame(
            version=PROTOCOL_VER,
            flags=FLAG_DATA,
            src=ID_PC,
            dst=ID_DRONE,
            opcode=opcode,
            payload=b"",
        )

        rx_buf = bytearray()
        for attempt in range(send_count):
            sent_at = time.monotonic()
            _serial().write(frame)
            logger.log_frame(f"drone-{label}-tx", frame)

            deadline = time.monotonic() + STATE_CONFIRM_TIMEOUT_S
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                response = _serial().read_frame(timeout_s=remaining, buf=rx_buf)
                if not response:
                    break
                parsed = parse_frame(response)
                if not parsed:
                    continue
                ack_ok = (
                    (parsed.flags & FLAG_ACK)
                    and parsed.opcode == opcode
                    and parsed.src == ID_DRONE
                    and parsed.dst == ID_PC
                    and parsed.payload == b""
                )
                if ack_ok:
                    logger.log_event(f"{label} confirmed by ACK")
                    return {"ok": True, "tx_count": attempt + 1}

            if attempt < send_count - 1:
                elapsed = time.monotonic() - sent_at
                time.sleep(max(0.0, retry_interval_s - elapsed))

        return {
            "ok": False,
            "error": f"{label.replace('-', ' ').title()} not confirmed",
            "attempts": send_count,
            "tx_count": send_count,
        }
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"{label} command failed: {exc}")
        return {"ok": False, "error": str(exc)}
    finally:
        state.telemetry_paused = False


def _command_code(command: str) -> int | None:
    name = (command or "").strip().upper()
    if not name:
        return None
    if not name.startswith("COMM_"):
        name = f"COMM_{name}"

    mapping = {
        "COMM_TAKE_OFF": 0,
        "COMM_LAND": 1,
        "COMM_HEIGHT": 2,
        "COMM_FORWARD": 3,
        "COMM_BACKWARD": 4,
        "COMM_LEFT": 5,
        "COMM_RIGHT": 6,
        "COMM_ROTATE_CW": 7,
        "COMM_ROTATE_CCW": 8,
        "COMM_WAIT": 9,
        "COMM_HOVER": 10,
        "COMM_FOLLOW": 11,
        "COMM_ACTION": 12,
        "COMM_RETURN_HOME": 13,
    }
    return mapping.get(name)


def _u8(value: int) -> int:
    return max(0, min(255, int(value)))


def _u16(value: int) -> int:
    return max(0, min(65535, int(value)))


def _encode_flight_path_payload(cmd: FlightPathCommand, command_id: int) -> bytes:
    code = _command_code(cmd.command)
    if code is None:
        raise ValueError(f"Unknown command: {cmd.command}")

    data = cmd.data or {}
    payload = bytearray()
    payload.append(_u8(code))
    payload.append(_u8(command_id))

    if code == 0:  # TAKE_OFF
        payload += struct.pack(">H", _u16(data.get("height_cm", 0)))
    elif code == 1:  # LAND
        payload += struct.pack(">H", _u16(data.get("delay_s", 0)))
    elif code == 2:  # HEIGHT
        payload += struct.pack(
            ">HH",
            _u16(data.get("height_cm", 0)),
            _u16(data.get("speed_cm_s", 0)),
        )
    elif code in (3, 4, 5, 6):  # FORWARD/BACKWARD/LEFT/RIGHT
        payload += struct.pack(
            ">HH",
            _u16(data.get("distance_cm", 0)),
            _u16(data.get("speed_cm_s", 0)),
        )
    elif code in (7, 8):  # ROTATE CW/CCW
        payload += struct.pack(
            ">HH",
            _u16(data.get("angle_deg", 0)),
            _u16(data.get("speed_deg_s", 0)),
        )
    elif code == 9:  # WAIT
        payload += struct.pack(">H", _u16(data.get("time_s", 0)))
    elif code == 10:  # HOVER (struct order: height_cm, time_s)
        payload += struct.pack(
            ">HH",
            _u16(data.get("height_cm", 0)),
            _u16(data.get("time_s", 0)),
        )
    elif code == 11:  # FOLLOW
        payload += struct.pack(
            ">BHH",
            _u8(data.get("follow_mode", 0)),
            _u16(data.get("distance_cm", 0)),
            _u16(data.get("timeout_s", 0)),
        )
    elif code == 12:  # ACTION
        payload += struct.pack(
            ">BHH",
            _u8(data.get("action_id", 0)),
            _u16(data.get("parameter1", 0)),
            _u16(data.get("parameter2", 0)),
        )
    elif code == 13:  # RETURN_HOME
        payload += struct.pack(
            ">HH",
            _u16(data.get("height_cm", 0)),
            _u16(data.get("speed_cm_s", 0)),
        )
    else:
        raise ValueError(f"Unsupported command code: {code}")

    return bytes(payload)


def _send_drone_flight_path(commands: list[FlightPathCommand]) -> dict:
    _sync_connection_state()
    if not _serial().is_connected:
        return {"ok": False, "error": "Not connected"}

    if not commands:
        return {"ok": False, "error": "No commands"}

    try:
        state.telemetry_paused = True
        rx_buf = bytearray()
        sent = 0

        for idx, cmd in enumerate(commands):
            payload = _encode_flight_path_payload(cmd, idx)
            frame = build_frame(
                version=PROTOCOL_VER,
                flags=FLAG_DATA,
                src=ID_PC,
                dst=ID_DRONE,
                opcode=OPT_DRONE_FLIGHT_PATH,
                payload=payload,
            )

            # Send each step and require its ACK before moving to the next step.
            send_count = 3
            confirmed = False
            for attempt in range(send_count):
                _serial().write(frame)
                logger.log_frame("drone-flight-path-tx", frame)
                sent += 1

                deadline = time.monotonic() + STATE_CONFIRM_TIMEOUT_S
                while time.monotonic() < deadline:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    response = _serial().read_frame(timeout_s=remaining, buf=rx_buf)
                    if not response:
                        break
                    parsed = parse_frame(response)
                    if not parsed:
                        continue
                    ack_ok = (
                        (parsed.flags & FLAG_ACK)
                        and parsed.opcode == OPT_DRONE_FLIGHT_PATH
                        and parsed.src == ID_DRONE
                        and parsed.dst == ID_PC
                        and parsed.payload == b""
                    )
                    if ack_ok:
                        confirmed = True
                        break
                if confirmed:
                    break
                if attempt < send_count - 1:
                    time.sleep(TX_RETRY_DELAY_S)

            if not confirmed:
                return {
                    "ok": False,
                    "error": "Flight path step not confirmed",
                    "failed_index": idx,
                    "attempts": send_count,
                    "tx_count": sent,
                }

        return {"ok": True, "tx_count": sent, "steps_sent": len(commands)}
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"Flight path send failed: {exc}")
        return {"ok": False, "error": str(exc)}
    finally:
        state.telemetry_paused = False


# Convert numeric status into human readable label -  GUI
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


def _flight_status_label(code: int) -> str:
    labels = {
        0: "Ground",
        1: "Takeoff",
        2: "Flying",
        3: "Landing",
    }
    return labels.get(code, f"Flight {code}")


def _flight_command_label(code: int) -> str:
    labels = {
        0: "Take Off",
        1: "Land",
        2: "Height",
        3: "Forward",
        4: "Backward",
        5: "Left",
        6: "Right",
        7: "Rotate CW",
        8: "Rotate CCW",
        9: "Wait",
        10: "Hover",
        11: "Follow",
        12: "Action",
        13: "Return Home",
    }
    return labels.get(code, f"Command {code}")



# Decode TLV payload into GUI fields
def _parse_tlv_payload(payload: bytes) -> dict:
    updates: dict = {}
    raw_updates: dict = {}
    battery_main_set = False
    battery_edf_set = False
    battery_seen = 0
    angle_scale = 100.0
    position_scale = 1000.0
    velocity_scale = 1000.0
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

            # If firmware uses distinct TLVs, decode by TLV id.
            if TVL_BAT_MAIN != TVL_BAT_EDF:
                if tlv == TVL_BAT_MAIN:
                    battery_main_set = True
                    updates["battery_main_v"] = batt_v
                    updates["battery_v"] = batt_v
                    raw_updates["bAt"] = batt_v
                else:
                    battery_edf_set = True
                    updates["battery_motor_v"] = batt_v
                    raw_updates["bAt2"] = batt_v
                continue

            # If firmware uses the same TLV id for both batteries, decode by order.
            battery_seen += 1
            motor_first = bool(getattr(state, "battery_motor_first", False))
            is_motor = (battery_seen == 1 and motor_first) or (battery_seen == 2 and not motor_first)
            if is_motor:
                battery_edf_set = True
                updates["battery_motor_v"] = batt_v
                raw_updates["bAt2"] = batt_v
            else:
                battery_main_set = True
                updates["battery_main_v"] = batt_v
                updates["battery_v"] = batt_v
                raw_updates["bAt"] = batt_v

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
            if idx + 2 == len(payload):
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

        elif tlv == TVL_THROTTLE:
            if idx + 1 > len(payload):
                break
            thr = payload[idx]
            idx += 1
            updates["throttle"] = thr
            raw_updates["thr"] = thr

        elif tlv == TVL_FLIGHT_COM:
            if idx + 1 > len(payload):
                break
            flight_command = payload[idx]
            idx += 1
            updates["flight_command"] = _flight_command_label(flight_command)
            raw_updates["flight_command"] = updates["flight_command"]

        elif tlv == TVL_SERVO_ANGL:
            if idx + 8 > len(payload):
                break
            servo_xp = _signed16((payload[idx] << 8) | payload[idx + 1])
            servo_xn = _signed16((payload[idx + 2] << 8) | payload[idx + 3])
            servo_yp = _signed16((payload[idx + 4] << 8) | payload[idx + 5])
            servo_yn = _signed16((payload[idx + 6] << 8) | payload[idx + 7])
            idx += 8
            updates["tvc"] = {
                "xp": servo_xp / angle_scale,
                "xn": servo_xn / angle_scale,
                "yp": servo_yp / angle_scale,
                "yn": servo_yn / angle_scale,
            }
            raw_updates["servo_xp"] = updates["tvc"]["xp"]
            raw_updates["servo_xn"] = updates["tvc"]["xn"]
            raw_updates["servo_yp"] = updates["tvc"]["yp"]
            raw_updates["servo_yn"] = updates["tvc"]["yn"]

        elif tlv == TVL_FLIGHT_MODE:
            if idx + 1 > len(payload):
                break
            flight_status = payload[idx]
            idx += 1
            updates["flight_phase"] = _flight_status_label(flight_status)
            updates["mode"] = updates["flight_phase"]
            raw_updates["flight_mode"] = updates["flight_phase"]

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
            # TVL_ALT now carries TOF height in mm as uint16.
            tof_mm = (payload[idx] << 8) | payload[idx + 1]
            idx += 2
            raw_updates["uD"] = tof_mm / 10.0

        elif tlv == TVL_DRONE_POS:
            if idx + 6 > len(payload):
                break
            pos_x = _signed16((payload[idx] << 8) | payload[idx + 1])
            pos_y = _signed16((payload[idx + 2] << 8) | payload[idx + 3])
            pos_z = _signed16((payload[idx + 4] << 8) | payload[idx + 5])
            idx += 6
            updates["position"] = {
                "x": pos_x / position_scale,
                "y": pos_y / position_scale,
                "z": pos_z / position_scale,
            }
            raw_updates["pXs"] = updates["position"]["x"]
            raw_updates["pYs"] = updates["position"]["y"]
            raw_updates["pZs"] = updates["position"]["z"]

        elif tlv == TVL_DRONE_VEL:
            if idx + 6 > len(payload):
                break
            vel_x = _signed16((payload[idx] << 8) | payload[idx + 1])
            vel_y = _signed16((payload[idx + 2] << 8) | payload[idx + 3])
            vel_z = _signed16((payload[idx + 4] << 8) | payload[idx + 5])
            idx += 6
            updates["velocity"] = {
                "vx": vel_x / velocity_scale,
                "vy": vel_y / velocity_scale,
                "vz": vel_z / velocity_scale,
            }
            raw_updates["vXs"] = updates["velocity"]["vx"]
            raw_updates["vYs"] = updates["velocity"]["vy"]
            raw_updates["vZs"] = updates["velocity"]["vz"]

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
            raw_updates["imu_temp"] = updates["imu_temp"]

        elif tlv == TVL_SOLVE_TIME:
            if idx + 4 > len(payload):
                break
            solve_time = (
                (payload[idx] << 24)
                | (payload[idx + 1] << 16)
                | (payload[idx + 2] << 8)
                | payload[idx + 3]
            )
            idx += 4
            updates["solve_time_us"] = solve_time / angle_scale

        else:
            break

    if raw_updates:
        updates["raw"] = raw_updates
    return updates


# Convert unsigned 16-bit to signed 16-bit
def _signed16(value: int) -> int:
    return value - 0x10000 if value & 0x8000 else value


# Scaling for battery values from firmware
def _decode_battery_v(raw: int) -> float:    
    # Firmware has historically reported battery as either:
    # - centivolts (0.01V units): e.g. 12.00V -> 1200, 23.50V -> 2350
    # - millivolts:              e.g. 12.00V -> 12000, 23.50V -> 23500
    # Use a threshold that correctly separates typical ranges.
    if raw < 10000:
        return raw / 100.0
    return raw / 1000.0



# Merge decoded telemetry into the cached payload
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
        state.telemetry_seq += 1
        payload["tlm_rate"] = state.tlm_rate_hz
        payload["_telemetry_seq"] = state.telemetry_seq
        if raw_updates:
            payload.setdefault("raw", {})
            payload["raw"].update(raw_updates)
        state.last_telemetry = payload


# Background thread to pull UART data and updates telemetry cache
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
        state.drone_connected = True
        decoded = _parse_tlv_payload(parsed.payload)
        _apply_telemetry(decoded)



# Basic connection status for GUI
@app.get("/status")
def status() -> dict:
    _sync_connection_state()
    return {
        "ok": True,
        "connection_status": _connection_status(),
        "connection_port": state.port,
        "drone_connected": state.drone_connected,
    }


# List available COM ports and current connection
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


# Open serial port and reset cached telemetry
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
        # Drop stale frames from previous session before status/telemetry handling.
        _serial().reset_input()
        state.port = request.port
        state.baud_rate = request.baud_rate
        state.error_tx_streak = 0
        state.drone_connected = False

        with state.telemetry_lock:
            state.telemetry_seq = 0
            state.last_telemetry = _zero_payload()
        try:
            # Check that telemetry stream is disabled when opening link
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


# Close port and clear state
@app.post("/disconnect")
def disconnect() -> dict:
    _serial().disconnect()
    state.port = ""
    state.baud_rate = 0
    state.error_tx_streak = 0
    state.drone_connected = False
    state.telemetry_seq = 0
    with state.telemetry_lock:
        state.last_telemetry = _zero_payload()
    logger.log_event("Disconnected")
    return {
        "connection_port": state.port,
        "connection_status": _connection_status(),
    }


# Send a ping/pong test through the link - UNUSED
@app.post("/ping")
def ping() -> dict: 
    _sync_connection_state()
    return send_ping(_serial(), logger)


# Run pairing routine with the drone
@app.post("/pair")
def pair() -> dict:
    return run_pairing(_serial(), state, logger)


@app.post("/drone/arm")
def drone_arm() -> dict:
    return _send_drone_state(TVL_STATE_ARM)


@app.post("/drone/disarm")
def drone_disarm() -> dict:
    return _send_drone_state(TVL_STATE_IDLE)


@app.post("/drone/fly")
def drone_fly() -> dict:
    return _send_drone_state(TVL_STATE_FLY)


@app.post("/drone/fly_over")
def drone_fly_over() -> dict:
    return _send_drone_state(TVL_STATE_FLY_OVER)


@app.post("/drone/land_now")
def drone_land_now() -> dict:
    return _send_drone_opcode_command(OPT_LAND_NOW, "land-now")


@app.post("/drone/e_stop")
def drone_e_stop() -> dict:
    return _send_drone_opcode_command(
        OPT_E_KILL,
        "e-stop",
        send_count=10,
        retry_interval_s=0.5,
    )


@app.post("/drone/fpath_clear")
def drone_fpath_clear() -> dict:
    return _send_drone_fpath_clear()


@app.post("/drone/zero_compass")
def drone_zero_compass() -> dict:
    return _send_drone_opcode_command(
        OPT_ZERO_COMPAS,
        "zero-compass",
        send_count=10,
    )


@app.post("/drone/flight_path")
def drone_flight_path(request: FlightPathRequest) -> dict:
    return _send_drone_flight_path(request.commands)


@app.post("/log_dump")
def log_dump(request: LogDumpRequest) -> dict:
    _sync_connection_state()
    if not _serial().is_connected:
        return {"ok": False, "error": "Not connected"}
    if not request.output_path.strip():
        return {"ok": False, "error": "Output path is empty"}

    try:
        state.telemetry_paused = True
        _serial().reset_input()
        frame = build_frame(
            version=PROTOCOL_VER,
            flags=FLAG_DATA,
            src=ID_PC,
            dst=ID_DRONE,
            opcode=OPT_LOG_DUMP,
            payload=b"",
        )
        _serial().write(frame)
        logger.log_frame("log-dump-tx", frame)

        raw = _serial().read_raw_until_idle(
            idle_timeout_s=1.0,
            max_duration_s=LOG_DUMP_MAX_DURATION_S,
        )
        if not raw:
            return {"ok": False, "error": "No log data received"}

        records, leftover = _decode_log_records(raw)
        if not records:
            return {"ok": False, "error": "Received data is not a valid log stream"}

        out_path = _write_log_csv(request.output_path, records)
        if leftover:
            logger.log_event(f"Log dump saved with {leftover} trailing bytes ignored")
        return {
            "ok": True,
            "file_path": str(out_path),
            "records_saved": len(records),
            "bytes_received": len(raw),
            "bytes_ignored": leftover,
        }
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"Log dump failed: {exc}")
        return {"ok": False, "error": str(exc)}
    finally:
        state.telemetry_paused = False


@app.post("/log_dump_ftdi")
def log_dump_ftdi(request: FtdiLogDumpRequest) -> dict:
    output_path = (request.output_path or "").strip()
    if not output_path:
        return {"ok": False, "error": "Output path is empty"}
    if not _ftdi_is_connected():
        return {"ok": False, "error": "FTDI not connected"}

    try:
        ftdi_serial.reset_input()
        frame = build_frame(
            version=PROTOCOL_VER,
            flags=FLAG_DATA,
            src=ID_PC,
            dst=ID_DRONE,
            opcode=OPT_LOG_DUMP,
            payload=b"",
        )
        ftdi_serial.write(frame)
        logger.log_frame("log-dump-ftdi-tx", frame)

        raw = ftdi_serial.read_raw_until_idle(
            idle_timeout_s=1.0,
            max_duration_s=LOG_DUMP_MAX_DURATION_S,
        )
        if not raw:
            return {"ok": False, "error": "No log data received"}

        records, leftover = _decode_log_records(raw)
        if not records:
            return {"ok": False, "error": "Received data is not a valid log stream"}

        out_path = _write_log_csv(output_path, records)
        if leftover:
            logger.log_event(f"FTDI log dump saved with {leftover} trailing bytes ignored")
        return {
            "ok": True,
            "file_path": str(out_path),
            "records_saved": len(records),
            "bytes_received": len(raw),
            "bytes_ignored": leftover,
        }
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"FTDI log dump failed: {exc}")
        return {"ok": False, "error": str(exc)}


@app.post("/log_rm_ftdi")
def log_rm_ftdi() -> dict:
    if not _ftdi_is_connected():
        return {"ok": False, "error": "FTDI not connected"}
    try:
        ftdi_serial.reset_input()
        frame = build_frame(
            version=PROTOCOL_VER,
            flags=FLAG_DATA,
            src=ID_PC,
            dst=ID_DRONE,
            opcode=OPT_LOG_RM,
            payload=b"",
        )
        ftdi_serial.write(frame)
        logger.log_frame("log-rm-ftdi-tx", frame)

        rx_buf = bytearray()
        response = ftdi_serial.read_frame(timeout_s=1.0, buf=rx_buf)
        if response:
            parsed = parse_frame(response)
            if (
                parsed
                and (parsed.flags & FLAG_ACK)
                and parsed.opcode == OPT_LOG_RM
                and parsed.src == ID_DRONE
                and parsed.dst == ID_PC
            ):
                return {"ok": True, "ack": True}
        return {"ok": True, "ack": False}
    except Exception as exc:  # noqa: BLE001
        logger.log_event(f"FTDI log remove failed: {exc}")
        return {"ok": False, "error": str(exc)}


@app.get("/ftdi/ports")
def ftdi_ports() -> dict:
    error = None
    if not ftdi_serial.available:
        error = "pyserial not installed"
    return {"ports": ftdi_serial.list_ports(), "error": error}


@app.get("/ftdi/status")
def ftdi_status() -> dict:
    connected = _ftdi_is_connected()
    return {
        "connected": connected,
        "port": ftdi_port if connected else "",
        "baud_rate": ftdi_baud_rate if connected else 0,
    }


@app.post("/ftdi/connect")
def ftdi_connect(request: ConnectRequest) -> dict:
    global ftdi_port, ftdi_baud_rate
    if not ftdi_serial.available:
        return {"ok": False, "error": "pyserial not installed"}
    try:
        ftdi_serial.connect(request.port, int(request.baud_rate))
        ftdi_serial.reset_input()
        ftdi_port = request.port
        ftdi_baud_rate = int(request.baud_rate)
        return {"ok": True, "connected": True, "port": ftdi_port, "baud_rate": ftdi_baud_rate}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@app.post("/ftdi/disconnect")
def ftdi_disconnect() -> dict:
    global ftdi_port, ftdi_baud_rate
    ftdi_serial.disconnect()
    ftdi_port = ""
    ftdi_baud_rate = 0
    return {"ok": True, "connected": False, "port": "", "baud_rate": 0}


# Read pairing configuration
@app.get("/pair_config")
def pair_config() -> dict:
    return {
        "max_retransmits": state.max_retransmits,
        "require_status_ack": state.require_status_ack,
        "telemetry_confirms_connection": state.telemetry_confirms_connection,
    }


# Update pairing configuration and persist it
@app.post("/pair_config")
def update_pair_config(payload: dict) -> dict:
    value = payload.get("max_retransmits")
    if isinstance(value, int):
        state.max_retransmits = max(0, min(10, value))
    require_status_ack = payload.get("require_status_ack")
    if isinstance(require_status_ack, bool):
        state.require_status_ack = require_status_ack
    telemetry_confirms_connection = payload.get("telemetry_confirms_connection")
    if isinstance(telemetry_confirms_connection, bool):
        state.telemetry_confirms_connection = telemetry_confirms_connection
    state.save_config()
    return {
        "max_retransmits": state.max_retransmits,
        "require_status_ack": state.require_status_ack,
        "telemetry_confirms_connection": state.telemetry_confirms_connection,
    }


# Return counters used by the GUI for TX packets
@app.get("/pair_stats")
def pair_stats() -> dict:
    return {
        "error_tx_count": state.error_tx_count,
        "error_tx_streak": state.error_tx_streak,
    }


# Return the latest cached telemetry (per drone in future)
@app.get("/telemetry")
def telemetry(drone: str = "amon") -> dict:
    _ = drone
    with state.telemetry_lock:
        return state.last_telemetry or _zero_payload()


# Start UART reader thread when backend starts
@app.on_event("startup")
def _start_telemetry_thread() -> None:
    thread = threading.Thread(target=_telemetry_worker, daemon=True)
    thread.start()


if __name__ == "__main__":
    import uvicorn

    # Local development entry point
    uvicorn.run("backend_server:app", host="127.0.0.1", port=8002, log_level="info")
