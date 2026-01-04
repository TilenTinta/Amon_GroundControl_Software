from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


class LinkState:
    def __init__(self) -> None:
        self.port = ""


state = LinkState()


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
        "throttle": 0,
        "tvc": {"x": 0, "y": 0, "z": 0},
        "link_quality": 0,
        "link_latency": 0,
        "packet_loss": 0,
        "mode": "-",
    }


def _connection_status() -> str:
    return f"Connected to {state.port}" if state.port else "Disconnected"


@app.get("/status")
def status() -> dict:
    return {"ok": True, "connection_status": _connection_status()}


@app.get("/ports")
def ports() -> dict:
    return {
        "ports": ["COM3", "COM4"],
        "connection_port": state.port,
        "connection_status": _connection_status(),
    }


@app.post("/connect")
def connect(request: ConnectRequest) -> dict:
    state.port = request.port
    return {
        "connection_port": state.port,
        "connection_status": _connection_status(),
    }


@app.post("/disconnect")
def disconnect() -> dict:
    state.port = ""
    return {
        "connection_port": state.port,
        "connection_status": _connection_status(),
    }


@app.get("/telemetry")
def telemetry(drone: str = "amon") -> dict:
    _ = drone
    return _zero_payload()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend_server:app", host="127.0.0.1", port=8000, log_level="info")
