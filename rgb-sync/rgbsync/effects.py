"""软件灯效：每帧为每个灯区计算颜色，所有设备共用同一时钟，所以天然同步。

effect(t, n, settings) -> List[RGB]，n 为该灯区 LED 数。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Dict, List

from .color import BLACK, RGB, hsv, scale


@dataclass
class EffectSettings:
    color: RGB = (255, 255, 255)
    color2: RGB = (0, 120, 255)
    speed: float = 1.0          # 0.1 ~ 5
    brightness: float = 1.0     # 0 ~ 1
    marker: int = -1            # identify 效果用：点亮第几颗灯
    extra: Dict[str, float] = field(default_factory=dict)


def static(t: float, n: int, s: EffectSettings) -> List[RGB]:
    return [s.color] * n


def breathing(t: float, n: int, s: EffectSettings) -> List[RGB]:
    k = 0.5 - 0.5 * math.cos(t * s.speed * math.pi * 0.8)
    return [scale(s.color, 0.05 + 0.95 * k)] * n


def color_cycle(t: float, n: int, s: EffectSettings) -> List[RGB]:
    return [hsv(t * s.speed * 0.1)] * n


def rainbow_wave(t: float, n: int, s: EffectSettings) -> List[RGB]:
    base = t * s.speed * 0.15
    return [hsv(base + i / max(n, 1)) for i in range(n)]


def gradient(t: float, n: int, s: EffectSettings) -> List[RGB]:
    k = 0.5 - 0.5 * math.cos(t * s.speed * math.pi * 0.5)
    c = tuple(int(a + (b - a) * k) for a, b in zip(s.color, s.color2))
    return [c] * n


def comet(t: float, n: int, s: EffectSettings) -> List[RGB]:
    if n <= 0:
        return []
    head = (t * s.speed * 8) % n
    out = []
    for i in range(n):
        d = (head - i) % n
        out.append(scale(s.color, max(0.0, 1 - d / 4)) if d < 4 else BLACK)
    return out


def identify(t: float, n: int, s: EffectSettings) -> List[RGB]:
    """数灯用：所有灯暗白，第 n 颗（最后一颗）亮红。看最后亮红的是第几颗即可确定灯数。"""
    out = [(20, 20, 20)] * n
    if n:
        out[-1] = (255, 0, 0)
    return out


def off(t: float, n: int, s: EffectSettings) -> List[RGB]:
    return [BLACK] * n


EFFECTS: Dict[str, Callable[[float, int, EffectSettings], List[RGB]]] = {
    "static": static,
    "breathing": breathing,
    "color_cycle": color_cycle,
    "rainbow_wave": rainbow_wave,
    "gradient": gradient,
    "comet": comet,
    "identify": identify,
    "off": off,
}

EFFECT_LABELS = {
    "static": "静态单色",
    "breathing": "呼吸",
    "color_cycle": "色彩循环（全部同色）",
    "rainbow_wave": "彩虹波浪",
    "gradient": "双色渐变",
    "comet": "流星追逐",
    "identify": "数灯模式（末灯红色）",
    "off": "关灯",
}

ANIMATED = {"breathing", "color_cycle", "rainbow_wave", "gradient", "comet"}


def render(name: str, t: float, n: int, s: EffectSettings) -> List[RGB]:
    colors = EFFECTS[name](t, n, s)
    if s.brightness < 1.0:
        colors = [scale(c, s.brightness) for c in colors]
    return colors
