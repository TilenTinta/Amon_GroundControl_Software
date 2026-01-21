from __future__ import annotations

from dataclasses import dataclass, field

from .serial_comm import SerialManager


@dataclass
class LinkState:
    port: str = ""
    baud_rate: int = 0
    serial: SerialManager = field(default_factory=SerialManager)
    max_retransmits: int = 3
    error_tx_count: int = 0
    error_tx_streak: int = 0
