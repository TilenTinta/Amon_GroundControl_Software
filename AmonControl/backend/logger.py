####################################################################
# File Name          : logger.py
# Author             : Tinta T.
# Version            : V1.0.0
# Date               : 2026/02/09
# Description        : Logging logic for terminal output
####################################################################

from __future__ import annotations

import logging


def get_logger(name: str = "amon") -> logging.Logger:

    # Create or fetch a shared logger instance by name
    logger = logging.getLogger(name)

    # Only attach handlers once to avoid same logs
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter("[%(levelname)s] %(message)s") # Keep logs compact for terminal logs
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO) # INFO for normal logs
    return logger


class DataLogger:
    """Placeholder for future telemetry/file logging."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        # Allow injection of a custom logger (useful for tests).
        self._logger = logger or get_logger()

    # Simple info log
    def log_event(self, message: str) -> None:
        self._logger.info(message)

    # Hex dump for binary frames readable in logs
    def log_frame(self, label: str, frame: bytes) -> None:
        self._logger.info("%s: %s", label, frame.hex())
