from __future__ import annotations

import logging


def get_logger(name: str = "amon") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter("[%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


class DataLogger:
    """Placeholder for future telemetry/file logging."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._logger = logger or get_logger()

    def log_event(self, message: str) -> None:
        self._logger.info(message)

    def log_frame(self, label: str, frame: bytes) -> None:
        self._logger.debug("%s: %s", label, frame.hex())
