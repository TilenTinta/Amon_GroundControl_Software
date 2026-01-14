from __future__ import annotations

import time
from typing import Optional

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    serial = None
    list_ports = None

from .protocol import SIG_SOF


class SerialManager:
    def __init__(self) -> None:
        self._serial: Optional["serial.Serial"] = None

    @property
    def available(self) -> bool:
        return serial is not None and list_ports is not None

    def list_ports(self) -> list[str]:
        if list_ports is None:
            return []
        return [port.device for port in list_ports.comports()]

    def connect(self, port: str, baud_rate: int) -> None:
        if serial is None:
            raise RuntimeError("pyserial not installed")
        self.disconnect()
        self._serial = serial.Serial(
            port,
            baudrate=baud_rate,
            timeout=0.3,
            write_timeout=0.5,
        )

    def disconnect(self) -> None:
        if self._serial:
            try:
                self._serial.close()
            except Exception:  # noqa: BLE001
                pass
        self._serial = None

    @property
    def is_connected(self) -> bool:
        return self._serial is not None

    def reset_input(self) -> None:
        if self._serial:
            self._serial.reset_input_buffer()

    def write(self, data: bytes) -> None:
        if not self._serial:
            raise RuntimeError("Serial port not open")
        self._serial.write(data)

    def read_frame(self, timeout_s: float = 1.0) -> bytes | None:
        if not self._serial:
            return None
        deadline = time.monotonic() + timeout_s
        buf = bytearray()
        while time.monotonic() < deadline:
            chunk = self._serial.read(1)
            if chunk:
                buf.extend(chunk)
            else:
                continue
            while len(buf) >= 2:
                if buf[0] != SIG_SOF:
                    buf.pop(0)
                    continue
                length = buf[1]
                total_len = 2 + length + 2
                if len(buf) < total_len:
                    break
                frame = bytes(buf[:total_len])
                del buf[:total_len]
                return frame
        return None
