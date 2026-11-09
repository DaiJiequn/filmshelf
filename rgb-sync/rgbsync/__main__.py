"""入口：
  python -m rgbsync                    打开图形界面
  python -m rgbsync --mock             无硬件，用虚拟设备试界面
  python -m rgbsync detect             只检测设备
  python -m rgbsync set "#FF0000"      所有设备设为红色并写入硬件
  python -m rgbsync run rainbow_wave   无界面后台运行某个灯效（Ctrl+C 退出）
  python -m rgbsync off                全部关灯
"""

from __future__ import annotations

import argparse
import sys
import time

from .color import parse_hex
from .config import Config
from .effects import EFFECT_LABELS
from .engine import SyncEngine


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="rgbsync", description="同时控制 ASUS Aura ARGB 风扇与七彩虹显卡灯光")
    p.add_argument("--mock", action="store_true", help="使用虚拟设备（无需硬件）")
    p.add_argument("--gpu-protocol", choices=["v1", "v2"], help="显卡灯控包格式，默认 v1")
    p.add_argument("--gpu-any-vendor", action="store_true", help="不检查七彩虹子厂商 ID，直接在 0x61 握手")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("gui")
    sub.add_parser("detect")
    s = sub.add_parser("set")
    s.add_argument("color")
    r = sub.add_parser("run")
    r.add_argument("effect", choices=list(EFFECT_LABELS))
    r.add_argument("--color", default=None)
    r.add_argument("--speed", type=float, default=None)
    r.add_argument("--leds", type=int, default=None, help="每个 ARGB 接口的灯数")
    sub.add_parser("off")
    a = p.parse_args(argv)

    cfg = Config.load()
    if a.gpu_protocol:
        cfg.gpu_protocol = a.gpu_protocol
    if a.gpu_any_vendor:
        cfg.gpu_any_vendor = True

    if a.cmd in (None, "gui"):
        from .gui import run
        run(cfg, mock=a.mock)
        return 0

    eng = SyncEngine(cfg)
    eng.detect(mock=a.mock)
    if a.cmd == "detect":
        for t in eng.targets:
            print(f"  [{'x' if t.enabled else ' '}] {t.label}  灯数={t.leds}  key={t.key}")
        return 0 if eng.targets else 1
    if a.cmd == "set":
        eng.update(effect="static", color="#%02X%02X%02X" % parse_hex(a.color))
        eng.step(0)
        eng.save_to_hardware()
    elif a.cmd == "off":
        eng.update(effect="off")
        eng.step(0)
        eng.save_to_hardware()
    elif a.cmd == "run":
        eng.update(effect=a.effect)
        if a.color:
            eng.update(color="#%02X%02X%02X" % parse_hex(a.color))
        if a.speed:
            eng.update(speed=a.speed)
        if a.leds:
            for t in eng.targets:
                if t.kind == "fan":
                    eng.set_target(t.key, leds=a.leds)
        eng.start()
        print(f"正在运行 {EFFECT_LABELS[a.effect]}，Ctrl+C 退出")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    eng.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
