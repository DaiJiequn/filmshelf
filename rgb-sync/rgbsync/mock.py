"""虚拟设备：没有硬件时用于试界面 / 跑测试（--mock）。记录所有写入的包。"""

from __future__ import annotations

from typing import List, Tuple

from . import aura, colorful


class MockHid(aura.HidLike):
    def __init__(self, argb_headers: int = 2, mainboard_leds: int = 0, firmware: str = "AULA3-MOCK-0001"):
        self.written: List[bytes] = []
        self._pending: bytes = b""
        cfg = bytearray(60)
        cfg[0x02] = argb_headers
        cfg[0x1B] = mainboard_leds
        self.cfg = bytes(cfg)
        self.firmware = firmware

    def write(self, data: bytes) -> int:
        data = bytes(data)
        self.written.append(data)
        if data[1] == aura.CMD_FIRMWARE:
            fw = self.firmware.encode().ljust(16, b"\0")
            self._pending = (b"\xEC\x02" + fw).ljust(65, b"\0")
        elif data[1] == aura.CMD_CONFIG:
            self._pending = (b"\xEC\x30\x00\x00" + self.cfg).ljust(65, b"\0")
        return len(data)

    def read(self, size: int, timeout_ms: int = 0):
        p, self._pending = self._pending, b""
        return list(p[:size])

    def close(self) -> None:
        pass


class MockI2C(colorful.I2CTransport):
    description = "mock-i2c"

    def __init__(self):
        self.written: List[Tuple[int, bytes]] = []

    def write(self, addr: int, data: bytes) -> None:
        self.written.append((addr, bytes(data)))

    def read(self, addr: int, size: int) -> bytes:
        return bytes([0xAA, 0xEF, 0x81]).ljust(size, b"\0")

    def close(self) -> None:
        pass


def mock_devices(gpu_protocol: str = "v1"):
    mb = aura.AuraMainboard(MockHid(), "虚拟 Aura 主板")
    gpu = colorful.ColorfulGPU(MockI2C(), "虚拟 七彩虹 RTX 5080 Ultra", gpu_protocol)
    gpu.handshake()
    return [mb], [gpu]
