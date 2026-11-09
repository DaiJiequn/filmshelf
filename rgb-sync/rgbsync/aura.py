"""ASUS Aura USB 主板灯控（X570 及之后的主板，VID 0x0B05）。

协议参考 OpenRGB 逆向成果（AsusAuraUSBController / AsusAuraMainboardController）：
  所有包 65 字节、零填充、byte0 = 0xEC
  EC 82                      读固件版本  -> EC 02 + 16 字节字符串
  EC B0                      读配置表    -> EC 30 ?? ?? + 60 字节
  EC 52 53 00 01             初始化（OpenRGB 称为 SetGen1）
  EC 35 ch 00 shut mode      设置灯效通道的模式（0xFF = Direct）
  EC 36 mH mL shut RGB...    设置灯效颜色（mask 指定 LED）
  EC 3F 55                   提交/保存
  EC 40 cmd off n RGB*n      Direct 逐灯，每包 ≤20 灯，最后一包 cmd|=0x80 生效
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence

from .color import RGB

AURA_VID = 0x0B05
AURA_MAINBOARD_PIDS = (0x18F3, 0x1939, 0x19AF, 0x1AA6, 0x1BED)
AURA_USAGE_PAGE = 0xFF72

PACKET_LEN = 65
LEDS_PER_PACKET = 20

CMD_FIRMWARE = 0x82
CMD_CONFIG = 0xB0
CMD_EFFECT = 0x35
CMD_EFFECT_COLOR = 0x36
CMD_COMMIT = 0x3F
CMD_DIRECT = 0x40
DIRECT_APPLY = 0x80
DIRECT_OVERFLOW = 0x10

MODE_OFF = 0x00
MODE_STATIC = 0x01
MODE_BREATHING = 0x02
MODE_SPECTRUM = 0x04
MODE_DIRECT = 0xFF

MAINBOARD_DIRECT_CHANNEL = 0x04


def packet(*payload: int) -> bytes:
    buf = bytearray(PACKET_LEN)
    buf[0] = 0xEC
    for i, b in enumerate(payload):
        buf[1 + i] = b & 0xFF
    return bytes(buf)


def direct_packets(direct_channel: int, colors: Sequence[RGB]) -> List[bytes]:
    """把一串颜色切成 Direct 包（与 OpenRGB SendDirect 逐字节一致）。"""
    out: List[bytes] = []
    command = direct_channel
    offset = 0
    configured = 0
    count = len(colors)
    in_packet = LEDS_PER_PACKET
    while configured < count:
        if configured + in_packet < count:
            configured += in_packet
        else:
            command |= DIRECT_APPLY
            in_packet = count - configured
            configured = count
        buf = bytearray(PACKET_LEN)
        buf[0] = 0xEC
        buf[1] = CMD_DIRECT
        buf[2] = command & 0xFF
        buf[3] = offset & 0xFF
        buf[4] = in_packet
        base = configured - in_packet
        for i in range(in_packet):
            r, g, b = colors[base + i]
            buf[5 + i * 3] = r
            buf[6 + i * 3] = g
            buf[7 + i * 3] = b
        out.append(bytes(buf))
        offset += in_packet
        if configured > 255:
            command |= DIRECT_OVERFLOW
            offset = configured - 256
    return out


@dataclass
class AuraZone:
    name: str
    kind: str            # "addressable" | "fixed"
    effect_channel: int
    direct_channel: int
    hw_leds: int         # 配置表里登记的 LED 数（ARGB 接口为 1，实际灯数由用户设置）


class HidLike:
    """hidapi 设备需要的最小接口（便于测试替换）。"""

    def write(self, data: bytes) -> int: ...
    def read(self, size: int, timeout_ms: int = 0) -> List[int]: ...
    def close(self) -> None: ...


class AuraMainboard:
    def __init__(self, dev: HidLike, name: str = "ASUS Aura 主板"):
        self.dev = dev
        self.name = name
        self.firmware = self._read_firmware()
        self.config = self._read_config()
        self.zones = self._build_zones()
        self._send(packet(0x52, 0x53, 0x00, 0x01))

    # ---- 底层收发 ----
    def _send(self, pkt: bytes) -> None:
        self.dev.write(pkt)

    def _request(self, pkt: bytes) -> bytes:
        self._send(pkt)
        data = bytes(self.dev.read(PACKET_LEN, 500) or b"")
        # 某些平台 read 不带 report id，补齐对齐到 OpenRGB 的偏移
        if data and data[0] != 0xEC:
            data = b"\xEC" + data
        return data

    def _read_firmware(self) -> str:
        r = self._request(packet(CMD_FIRMWARE))
        if len(r) >= 18 and r[1] == 0x02:
            return r[2:18].split(b"\x00")[0].decode("ascii", "replace")
        return "unknown"

    def _read_config(self) -> bytes:
        r = self._request(packet(CMD_CONFIG))
        if len(r) >= 64 and r[1] == 0x30:
            return bytes(r[4:64])
        raise IOError("读取 Aura 配置表失败（设备可能被 Armoury Crate 占用）")

    def _build_zones(self) -> List[AuraZone]:
        mb_leds = self.config[0x1B]
        rgb_headers = self.config[0x1D]
        argb_headers = self.config[0x02]
        if mb_leds < rgb_headers:
            rgb_headers = 0
        zones: List[AuraZone] = []
        effect_channel = 0
        from_zero = self.firmware.startswith("AULA3-AR32")
        if mb_leds > 0:
            ch = argb_headers if from_zero else effect_channel
            zones.append(AuraZone("主板灯", "fixed", ch, MAINBOARD_DIRECT_CHANNEL, mb_leds))
            if not from_zero:
                effect_channel += 1
        for i in range(argb_headers):
            zones.append(AuraZone(f"ARGB 接口 {i + 1}", "addressable", effect_channel, i, 1))
            effect_channel += 1
        return zones

    # ---- 对外接口 ----
    def set_mode(self, zone: AuraZone, mode: int, color: RGB = (0, 0, 0), save: bool = False) -> None:
        """切换硬件模式。mode=MODE_DIRECT 后即可 set_direct 实时刷新。"""
        self._send(packet(CMD_EFFECT, zone.effect_channel, 0x00, 0x00, mode))
        if mode == MODE_DIRECT:
            return
        start = 0
        for z in self.zones:
            if z is zone:
                break
            start += z.hw_leds
        mask = ((1 << zone.hw_leds) - 1) << start
        buf = bytearray(packet(CMD_EFFECT_COLOR, mask >> 8, mask & 0xFF, 0x00))
        for i in range(zone.hw_leds):
            pos = 5 + 3 * (start + i)
            if pos + 2 < PACKET_LEN:
                buf[pos:pos + 3] = bytes(color)
        self._send(bytes(buf))
        if save:
            self.commit()

    def commit(self) -> None:
        self._send(packet(CMD_COMMIT, 0x55))

    def set_direct(self, zone: AuraZone, colors: Sequence[RGB]) -> None:
        for pkt in direct_packets(zone.direct_channel, colors):
            self._send(pkt)

    def close(self) -> None:
        try:
            self.dev.close()
        except Exception:
            pass


def find_mainboards(log: Callable[[str], None] = print) -> List[AuraMainboard]:
    try:
        import hid  # pip install hidapi
    except ImportError:
        log("未安装 hidapi（pip install hidapi），跳过主板检测")
        return []
    found: List[AuraMainboard] = []
    seen = set()
    infos = [i for i in hid.enumerate(AURA_VID, 0) if i.get("product_id") in AURA_MAINBOARD_PIDS]
    # 同一个 PID 有多个接口时优先 usage_page 0xFF72
    infos.sort(key=lambda i: i.get("usage_page") != AURA_USAGE_PAGE)
    for info in infos:
        pid = info["product_id"]
        if pid in seen:
            continue
        try:
            d = hid.device()
            d.open_path(info["path"])
            mb = AuraMainboard(_HidAdapter(d), f"ASUS Aura 主板 (PID {pid:04X})")
            seen.add(pid)
            found.append(mb)
            log(f"发现 {mb.name}，固件 {mb.firmware}，ARGB 接口 {sum(z.kind == 'addressable' for z in mb.zones)} 个")
        except Exception as e:  # noqa: BLE001
            log(f"打开 Aura 设备 {pid:04X} 失败：{e}")
    return found


class _HidAdapter(HidLike):
    def __init__(self, d):
        self.d = d

    def write(self, data: bytes) -> int:
        return self.d.write(list(data))

    def read(self, size: int, timeout_ms: int = 0) -> List[int]:
        return self.d.read(size, timeout_ms)

    def close(self) -> None:
        self.d.close()
