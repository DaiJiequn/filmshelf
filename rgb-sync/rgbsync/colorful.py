"""七彩虹 iGame 显卡灯控（显卡 I²C 总线，地址 0x61）。

协议参考 OpenRGB ColorfulGPUController：
  包格式  AA EF <cmd> ... <校验和低字节> <校验和高字节>
  校验和  = 之前所有字节之和（16 位，小端）
  握手    写 AA EF 81 02 1C 02，读 64 字节，以 AA EF 81 开头即为七彩虹灯控
  V1 单色 AA EF 12 03 01 FF R G B CK_L CK_H              （11 字节，大多数 Ultra W / Advanced）
  V2 逐区 AA EF 01 04 88 26 [R G B]*38 CK_L CK_H          （122 字节，4070 Vulcan / 4090 Neptune）
"""

from __future__ import annotations

import os
import sys
from typing import Callable, List, Optional, Sequence

from .color import RGB

COLORFUL_SUBVENDOR = 0x7377
NVIDIA_VENDOR = 0x10DE
COLORFUL_I2C_ADDR = 0x61
V2_ZONES = 38


def with_checksum(body: Sequence[int]) -> bytes:
    s = sum(body) & 0xFFFF
    return bytes(body) + bytes((s & 0xFF, s >> 8))


def handshake_packet() -> bytes:
    return bytes((0xAA, 0xEF, 0x81, 0x02, 0x1C, 0x02))


def v1_packet(color: RGB) -> bytes:
    r, g, b = color
    return with_checksum((0xAA, 0xEF, 0x12, 0x03, 0x01, 0xFF, r, g, b))


def v2_packet(colors: Sequence[RGB]) -> bytes:
    body = [0xAA, 0xEF, 0x01, 0x04, 0x88, 0x26]
    for i in range(V2_ZONES):
        body.extend(colors[i % len(colors)] if colors else (0, 0, 0))
    return with_checksum(body)


class I2CTransport:
    description = "I2C"

    def write(self, addr: int, data: bytes) -> None: ...
    def read(self, addr: int, size: int) -> bytes: ...
    def close(self) -> None: ...


class ColorfulGPU:
    def __init__(self, bus: I2CTransport, name: str = "七彩虹 iGame 显卡", protocol: str = "v1",
                 addr: int = COLORFUL_I2C_ADDR):
        self.bus = bus
        self.name = name
        self.protocol = protocol  # "v1" | "v2"
        self.addr = addr
        self._last: Optional[bytes] = None

    def handshake(self) -> bool:
        self.bus.write(self.addr, handshake_packet())
        r = self.bus.read(self.addr, 0x40)
        return len(r) >= 3 and r[0] == 0xAA and r[1] == 0xEF and r[2] == 0x81

    def set_colors(self, colors: Sequence[RGB], force: bool = False) -> None:
        if not colors:
            return
        pkt = v2_packet(colors) if self.protocol == "v2" else v1_packet(colors[0])
        if pkt == self._last and not force:
            return  # 颜色没变就不写总线
        self.bus.write(self.addr, pkt)
        self._last = pkt

    def close(self) -> None:
        self.bus.close()


# ---------------- Windows：NvAPI ----------------

class NvApiI2C(I2CTransport):
    """通过 nvapi64.dll 的未公开接口 NvAPI_I2CWriteEx / ReadEx 访问显卡 I²C（与 OpenRGB 相同）。"""

    def __init__(self, nv, handle, gpu_index: int):
        self.nv = nv
        self.handle = handle
        self.description = f"NvAPI GPU {gpu_index}"

    def _info(self, addr: int, buf):
        import ctypes
        info = self.nv.NV_I2C_INFO_V3()
        info.version = ctypes.sizeof(info) | (3 << 16)
        info.is_ddc_port = 0
        info.i2c_dev_address = (addr << 1) & 0xFF
        info.i2c_reg_address = None
        info.reg_addr_size = 0
        info.data = ctypes.cast(buf, ctypes.POINTER(ctypes.c_uint8))
        info.size = len(buf)
        info.i2c_speed = 0xFFFF
        info.i2c_speed_khz = 0  # NVAPI_I2C_SPEED_DEFAULT
        info.port_id = 1        # 灯控芯片挂在 port 1
        info.is_port_id_set = 1
        return info

    def write(self, addr: int, data: bytes) -> None:
        import ctypes
        buf = (ctypes.c_uint8 * len(data)).from_buffer_copy(data)
        info = self._info(addr, buf)
        unknown = ctypes.c_uint32(0)
        ret = self.nv.I2CWriteEx(self.handle, ctypes.byref(info), ctypes.byref(unknown))
        if ret != 0:
            raise IOError(f"NvAPI_I2CWriteEx 失败：{ret}")

    def read(self, addr: int, size: int) -> bytes:
        import ctypes
        buf = (ctypes.c_uint8 * size)()
        info = self._info(addr, buf)
        unknown = ctypes.c_uint32(0)
        ret = self.nv.I2CReadEx(self.handle, ctypes.byref(info), ctypes.byref(unknown))
        if ret != 0:
            raise IOError(f"NvAPI_I2CReadEx 失败：{ret}")
        return bytes(buf[: info.size])

    def close(self) -> None:
        pass


class _NvApi:
    def __init__(self):
        import ctypes
        from ctypes import POINTER, c_int32, c_uint8, c_uint32, c_void_p

        class NV_I2C_INFO_V3(ctypes.Structure):
            _fields_ = [
                ("version", c_uint32),
                ("display_mask", c_uint32),
                ("is_ddc_port", c_uint8),
                ("i2c_dev_address", c_uint8),
                ("i2c_reg_address", POINTER(c_uint8)),
                ("reg_addr_size", c_uint32),
                ("data", POINTER(c_uint8)),
                ("size", c_uint32),
                ("i2c_speed", c_uint32),
                ("i2c_speed_khz", c_uint32),
                ("port_id", c_uint8),
                ("is_port_id_set", c_uint32),
            ]

        self.NV_I2C_INFO_V3 = NV_I2C_INFO_V3
        dll = ctypes.CDLL("nvapi64.dll" if sys.maxsize > 2 ** 32 else "nvapi.dll")
        qi = dll.nvapi_QueryInterface
        qi.restype = c_void_p
        qi.argtypes = [c_uint32]

        def fn(iid, *argtypes):
            addr = qi(iid)
            if not addr:
                raise OSError(f"NvAPI 接口 0x{iid:08X} 不可用")
            return ctypes.CFUNCTYPE(c_int32, *argtypes)(addr)

        self.Initialize = fn(0x0150E828)
        self.EnumPhysicalGPUs = fn(0xE5AC921F, POINTER(c_void_p), POINTER(c_int32))
        self.GetPCIIdentifiers = fn(0x2DDFB66E, c_void_p, POINTER(c_uint32), POINTER(c_uint32),
                                    POINTER(c_uint32), POINTER(c_uint32))
        self.I2CWriteEx = fn(0x283AC65A, c_void_p, POINTER(NV_I2C_INFO_V3), POINTER(c_uint32))
        self.I2CReadEx = fn(0x4D7B0709, c_void_p, POINTER(NV_I2C_INFO_V3), POINTER(c_uint32))
        if self.Initialize() != 0:
            raise OSError("NvAPI_Initialize 失败")

    def gpus(self):
        import ctypes
        handles = (ctypes.c_void_p * 64)()
        count = ctypes.c_int32(0)
        self.EnumPhysicalGPUs(handles, ctypes.byref(count))
        for i in range(count.value):
            dev, sub, rev, ext = (ctypes.c_uint32() for _ in range(4))
            self.GetPCIIdentifiers(handles[i], ctypes.byref(dev), ctypes.byref(sub),
                                   ctypes.byref(rev), ctypes.byref(ext))
            yield i, handles[i], dev.value, sub.value


def _windows_buses(log):
    try:
        nv = _NvApi()
    except OSError as e:
        log(f"NvAPI 不可用：{e}")
        return
    for idx, handle, dev_id, sub_id in nv.gpus():
        sub_vendor, sub_device = sub_id & 0xFFFF, sub_id >> 16
        yield NvApiI2C(nv, handle, idx), sub_vendor, sub_device, dev_id >> 16


# ---------------- Linux：i2c-dev ----------------

class LinuxI2C(I2CTransport):
    I2C_SLAVE = 0x0703

    def __init__(self, bus_no: int):
        self.bus_no = bus_no
        self.description = f"/dev/i2c-{bus_no}"
        self.fd = os.open(self.description, os.O_RDWR)

    def _select(self, addr: int):
        import fcntl
        fcntl.ioctl(self.fd, self.I2C_SLAVE, addr)

    def write(self, addr: int, data: bytes) -> None:
        self._select(addr)
        os.write(self.fd, data)

    def read(self, addr: int, size: int) -> bytes:
        self._select(addr)
        return os.read(self.fd, size)

    def close(self) -> None:
        os.close(self.fd)


def _read_hex(path: str) -> int:
    try:
        with open(path) as f:
            return int(f.read().strip(), 16)
    except (OSError, ValueError):
        return 0


def _linux_buses(log):
    root = "/sys/bus/i2c/devices"
    if not os.path.isdir(root):
        return
    entries = []
    for ent in os.listdir(root):
        if not ent.startswith("i2c-"):
            continue
        try:
            with open(f"{root}/{ent}/name") as f:
                name = f.read().strip()
        except OSError:
            continue
        if not name.startswith("NVIDIA i2c adapter"):
            continue
        port = name.split()[3] if len(name.split()) > 3 else "?"
        entries.append((port != "1", int(ent[4:]), ent))  # port 1 优先
    for _, no, ent in sorted(entries):
        base = f"{root}/{ent}/device"
        try:
            bus = LinuxI2C(no)
        except OSError as e:
            log(f"打开 /dev/i2c-{no} 失败：{e}（需要 root 或 i2c 组权限，并 modprobe i2c-dev）")
            continue
        yield bus, _read_hex(f"{base}/subsystem_vendor"), _read_hex(f"{base}/subsystem_device"), \
            _read_hex(f"{base}/device")


def find_gpus(protocol: str = "v1", any_vendor: bool = False,
              log: Callable[[str], None] = print) -> List[ColorfulGPU]:
    """枚举 NVIDIA 显卡 I²C 总线，对七彩虹显卡做握手检测。"""
    buses = _windows_buses(log) if sys.platform == "win32" else _linux_buses(log)
    found: List[ColorfulGPU] = []
    for bus, sub_vendor, sub_device, device in buses or []:
        if found and isinstance(bus, LinuxI2C):
            bus.close()
            continue
        if sub_vendor and sub_vendor != COLORFUL_SUBVENDOR and not any_vendor:
            log(f"{bus.description}：子厂商 {sub_vendor:04X} 不是七彩虹，跳过")
            bus.close()
            continue
        gpu = ColorfulGPU(bus, f"七彩虹显卡 [{device:04X} 子系统 {sub_vendor:04X}:{sub_device:04X}]", protocol)
        try:
            ok = gpu.handshake()
        except Exception as e:  # noqa: BLE001
            ok = False
            log(f"{bus.description}：握手异常 {e}")
        if ok:
            log(f"发现 {gpu.name}（{bus.description}）")
            found.append(gpu)
        else:
            log(f"{bus.description}：地址 0x61 无七彩虹灯控应答")
            bus.close()
    return found
