"""同步引擎：一个时钟、一个灯效，同时驱动风扇（Aura ARGB 接口）与显卡。"""

from __future__ import annotations

import threading
import time
from typing import Callable, Dict, List, Optional

from . import aura, colorful
from .color import RGB, parse_hex
from .config import Config
from .effects import ANIMATED, EffectSettings, render

DEFAULT_ARGB_LEDS = 30  # 单个 ARGB 接口默认灯数，可在界面里用“数灯模式”校准


class Target:
    key: str
    label: str
    kind: str
    leds: int
    enabled: bool = True

    def prepare(self) -> None: ...
    def write(self, colors: List[RGB]) -> None: ...
    def save_static(self, color: RGB) -> None: ...
    def hardware_off(self) -> None: ...


class AuraTarget(Target):
    def __init__(self, mb: aura.AuraMainboard, zone: aura.AuraZone):
        self.mb, self.zone = mb, zone
        self.key = f"aura:{zone.direct_channel}:{zone.name}"
        self.label = f"{mb.name} · {zone.name}"
        self.kind = "fan" if zone.kind == "addressable" else "board"
        self.leds = DEFAULT_ARGB_LEDS if zone.kind == "addressable" else zone.hw_leds

    def prepare(self) -> None:
        self.mb.set_mode(self.zone, aura.MODE_DIRECT)

    def write(self, colors: List[RGB]) -> None:
        self.mb.set_direct(self.zone, colors)

    def save_static(self, color: RGB) -> None:
        self.mb.set_mode(self.zone, aura.MODE_STATIC, color, save=True)

    def hardware_off(self) -> None:
        self.mb.set_mode(self.zone, aura.MODE_OFF, save=True)


class GpuTarget(Target):
    def __init__(self, gpu: colorful.ColorfulGPU):
        self.gpu = gpu
        self.key = f"gpu:{gpu.name}"
        self.label = gpu.name
        self.kind = "gpu"
        self.leds = colorful.V2_ZONES if gpu.protocol == "v2" else 1

    def write(self, colors: List[RGB]) -> None:
        self.gpu.set_colors(colors)

    def save_static(self, color: RGB) -> None:
        self.gpu.set_colors([color], force=True)

    def hardware_off(self) -> None:
        self.gpu.set_colors([(0, 0, 0)], force=True)


class SyncEngine:
    def __init__(self, cfg: Config, log: Callable[[str], None] = print):
        self.cfg = cfg
        self.log = log
        self.targets: List[Target] = []
        self.mainboards: List[aura.AuraMainboard] = []
        self.gpus: List[colorful.ColorfulGPU] = []
        self.frame: Dict[str, List[RGB]] = {}
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._dirty = True
        self._errors: Dict[str, int] = {}

    # ---------- 设备 ----------
    def detect(self, mock: bool = False) -> None:
        self.close_devices()
        if mock:
            from .mock import mock_devices
            self.mainboards, self.gpus = mock_devices(self.cfg.gpu_protocol)
            self.log("模拟模式：已创建虚拟主板（2 个 ARGB 接口）和虚拟显卡")
        else:
            self.mainboards = aura.find_mainboards(self.log)
            self.gpus = colorful.find_gpus(self.cfg.gpu_protocol, self.cfg.gpu_any_vendor, self.log)
        targets: List[Target] = []
        for mb in self.mainboards:
            targets += [AuraTarget(mb, z) for z in mb.zones]
        targets += [GpuTarget(g) for g in self.gpus]
        for t in targets:
            t.leds = int(self.cfg.zone_leds.get(t.key, t.leds))
            t.enabled = bool(self.cfg.zone_enabled.get(t.key, t.kind != "board"))
        with self._lock:
            self.targets = targets
            self._dirty = True
        for t in targets:
            if t.enabled:
                self._safe(t, t.prepare)
        if not targets:
            self.log("没有检测到任何可控设备")

    def close_devices(self) -> None:
        for mb in self.mainboards:
            mb.close()
        for g in self.gpus:
            g.close()
        self.mainboards, self.gpus, self.targets = [], [], []

    def set_target(self, key: str, *, enabled: Optional[bool] = None, leds: Optional[int] = None) -> None:
        with self._lock:
            for t in self.targets:
                if t.key != key:
                    continue
                if enabled is not None:
                    if enabled and not t.enabled:
                        self._safe(t, t.prepare)
                    t.enabled = enabled
                    self.cfg.zone_enabled[key] = enabled
                if leds is not None and t.kind != "gpu":
                    t.leds = max(1, min(240, int(leds)))
                    self.cfg.zone_leds[key] = t.leds
            self._dirty = True

    # ---------- 设置 ----------
    def settings(self) -> EffectSettings:
        c = self.cfg
        return EffectSettings(parse_hex(c.color), parse_hex(c.color2), c.speed, c.brightness)

    def update(self, **kw) -> None:
        with self._lock:
            for k, v in kw.items():
                setattr(self.cfg, k, v)
            self._dirty = True

    # ---------- 渲染 ----------
    def render_frame(self, t: float) -> Dict[str, List[RGB]]:
        s = self.settings()
        name = self.cfg.effect
        frame: Dict[str, List[RGB]] = {}
        for tg in self.targets:
            if not tg.enabled:
                continue
            if tg.kind == "gpu" and tg.leds == 1:
                # 显卡只有一个颜色：取“灯带第 N 颗”的颜色，彩虹波浪时与风扇首尾相接
                idx = max(0, self.cfg.gpu_follows_led)
                ref = max((x.leds for x in self.targets if x.kind == "fan"), default=1)
                colors = render(name, t, max(ref, idx + 1), s)
                frame[tg.key] = [colors[min(idx, len(colors) - 1)]]
            else:
                frame[tg.key] = render(name, t, tg.leds, s)
        return frame

    def push(self, frame: Dict[str, List[RGB]]) -> None:
        for tg in list(self.targets):
            colors = frame.get(tg.key)
            if colors is None:
                continue
            self._safe(tg, lambda: tg.write(colors))

    def _safe(self, tg: Target, fn) -> None:
        try:
            fn()
            self._errors[tg.key] = 0
        except Exception as e:  # noqa: BLE001
            n = self._errors.get(tg.key, 0) + 1
            self._errors[tg.key] = n
            if n in (1, 10):
                self.log(f"{tg.label} 写入失败：{e}")
            if n >= 30:
                tg.enabled = False
                self.log(f"{tg.label} 连续失败，已暂停该设备")

    def step(self, t: float) -> bool:
        """渲染并下发一帧；返回是否真的写了设备。"""
        with self._lock:
            animated = self.cfg.effect in ANIMATED
            if not (animated or self._dirty):
                return False
            frame = self.render_frame(t)
            self._dirty = False
        self.frame = frame
        self.push(frame)
        return True

    # ---------- 线程 ----------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="rgbsync", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        t0 = time.monotonic()
        last_keepalive = 0.0
        while not self._stop.is_set():
            now = time.monotonic()
            if now - last_keepalive > 2.0:  # 静态效果也每 2 秒重发一次，防止设备回落到硬件灯效
                self._dirty = True
                last_keepalive = now
            self.step(now - t0)
            self._stop.wait(1.0 / max(1, min(60, self.cfg.fps)))

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    # ---------- 写入硬件（关掉程序后保持） ----------
    def save_to_hardware(self) -> None:
        off = self.cfg.effect == "off"
        color = self.settings().color
        for tg in self.targets:
            if tg.enabled:
                self._safe(tg, tg.hardware_off if off else (lambda: tg.save_static(color)))
        self.log("已写入硬件：" + ("关灯" if off else "静态主色") + "，关闭程序后保持")

    def shutdown(self) -> None:
        self.stop()
        self.close_devices()
