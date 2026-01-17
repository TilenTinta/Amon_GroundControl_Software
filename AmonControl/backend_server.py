from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.logger import DataLogger
from backend.pairing_service import run_pairing
from backend.ping_service import send_ping
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
        "signal_dbm": 0,
        "tlm_rate": 0,
        "gps_sat": 0,
        "imu_temp": 0,
        "baro_alt": 0,
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
    }


def _connection_status() -> str:
    return f"Connected to {state.port}" if state.port else "Disconnected"

def _sync_connection_state() -> None:
    if not _serial().check_connection():
        state.port = ""
        state.baud_rate = 0


def _serial() -> SerialManager:
    return state.serial


@app.get("/status")
def status() -> dict:
    _sync_connection_state()
    return {
        "ok": True,
        "connection_status": _connection_status(),
        "connection_port": state.port,
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
    return run_pairing(_serial(), logger)


@app.get("/telemetry")
def telemetry(drone: str = "amon") -> dict:
    _ = drone
    return _zero_payload()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend_server:app", host="127.0.0.1", port=8002, log_level="info")
