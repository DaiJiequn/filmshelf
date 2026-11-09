"""配置持久化：~/.rgbsync.json"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from typing import Dict

CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".rgbsync.json")


@dataclass
class Config:
    effect: str = "rainbow_wave"
    color: str = "#FFFFFF"
    color2: str = "#0078FF"
    speed: float = 1.0
    brightness: float = 1.0
    fps: int = 30
    gpu_protocol: str = "v1"        # v1 | v2
    gpu_any_vendor: bool = False    # 跳过子厂商 7377 检查
    gpu_follows_led: int = 0        # 显卡取风扇灯带的第几颗颜色（彩虹波浪时让显卡与风扇“连成一条”）
    zone_leds: Dict[str, int] = field(default_factory=dict)      # 灯区名 -> LED 数
    zone_enabled: Dict[str, bool] = field(default_factory=dict)

    @classmethod
    def load(cls, path: str = CONFIG_PATH) -> "Config":
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return cls()
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def save(self, path: str = CONFIG_PATH) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, ensure_ascii=False, indent=2)
