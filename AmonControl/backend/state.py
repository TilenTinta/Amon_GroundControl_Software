from __future__ import annotations

from dataclasses import dataclass, field

from .serial_comm import SerialManager


@dataclass
class LinkState:
    port: str = ""
    baud_rate: int = 0
    serial: SerialManager = field(default_factory=SerialManager)
