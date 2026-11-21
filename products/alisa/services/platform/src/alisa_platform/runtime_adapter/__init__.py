from dataclasses import dataclass
from typing import Protocol

RUNTIME_PORT_VERSION = "1"

class RuntimePort(Protocol):
    def capabilities(self) -> dict: ...

@dataclass(frozen=True)
class DisconnectedRuntime:
    def capabilities(self):
        return {"port_version": RUNTIME_PORT_VERSION, "status": "RUNTIME_NOT_CONNECTED"}
