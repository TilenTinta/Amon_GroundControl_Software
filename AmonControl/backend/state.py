####################################################################
# File Name          : state.py
# Author             : Tinta T.
# Version            : V1.0.0
# Date               : 2026/02/09
# Description        : Shared runtime state and persistent config
####################################################################

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import json
import threading

from .serial_comm import SerialManager

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"


# Link connection settings and runtime state
@dataclass
class LinkState:
    port: str = ""
    baud_rate: int = 0
    serial: SerialManager = field(default_factory=SerialManager)
    max_retransmits: int = 3
    error_tx_count: int = 0
    error_tx_streak: int = 0
    drone_connected: bool = False
    last_telemetry: dict = field(default_factory=dict)
    require_status_ack: bool = True
    telemetry_confirms_connection: bool = True
    telemetry_paused: bool = False
    battery_motor_first: bool = False
    telemetry_lock: threading.Lock = field(default_factory=threading.Lock)
    last_tlm_ts: float = 0.0
    tlm_rate_hz: float = 0.0
    telemetry_seq: int = 0


    # Load saved config after dataclass init
    def __post_init__(self) -> None:
        self.load_config()


    # Load settings from config.json if it exists
    def load_config(self) -> None:
        if not CONFIG_PATH.exists():
            return
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return
        
        max_retries = data.get("max_retransmits")
        if isinstance(max_retries, int):
            self.max_retransmits = max(0, min(10, max_retries))

        require_status_ack = data.get("require_status_ack")
        if isinstance(require_status_ack, bool):
            self.require_status_ack = require_status_ack

        telemetry_confirms_connection = data.get("telemetry_confirms_connection")
        if isinstance(telemetry_confirms_connection, bool):
            self.telemetry_confirms_connection = telemetry_confirms_connection

        battery_motor_first = data.get("battery_motor_first")
        if isinstance(battery_motor_first, bool):
            self.battery_motor_first = battery_motor_first


    # Save current settings to config.json
    def save_config(self) -> None:
        data = {
            "max_retransmits": self.max_retransmits,
            "require_status_ack": self.require_status_ack,
            "telemetry_confirms_connection": self.telemetry_confirms_connection,
            "battery_motor_first": self.battery_motor_first,
        }
        CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
