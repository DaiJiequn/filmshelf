"""tkinter 图形界面。"""

from __future__ import annotations

import queue
import tkinter as tk
from tkinter import colorchooser, messagebox, ttk

from . import __version__
from .color import to_hex
from .config import Config
from .effects import EFFECT_LABELS
from .engine import SyncEngine

PREVIEW_W = 360
PREVIEW_H = 18


class App:
    def __init__(self, root: tk.Tk, cfg: Config, mock: bool = False):
        self.root = root
        self.cfg = cfg
        self.mock = mock
        self.logq: "queue.Queue[str]" = queue.Queue()
        self.engine = SyncEngine(cfg, log=self.logq.put)
        self.rows = {}

        root.title(f"RGB Sync {__version__} — 风扇 + 显卡 灯光同步" + ("（模拟模式）" if mock else ""))
        root.minsize(640, 560)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        main = ttk.Frame(root, padding=10)
        main.pack(fill="both", expand=True)

        # ---- 设备 ----
        self.dev_frame = ttk.LabelFrame(main, text="设备（勾选参与同步；风扇可设灯数）", padding=8)
        self.dev_frame.pack(fill="x")

        # ---- 灯效 ----
        fx = ttk.LabelFrame(main, text="灯效", padding=8)
        fx.pack(fill="x", pady=8)
        fx.columnconfigure(1, weight=1)

        ttk.Label(fx, text="效果").grid(row=0, column=0, sticky="w")
        self.effect_keys = list(EFFECT_LABELS)
        self.effect_var = tk.StringVar(value=EFFECT_LABELS.get(cfg.effect, EFFECT_LABELS["static"]))
        cb = ttk.Combobox(fx, textvariable=self.effect_var, state="readonly",
                          values=[EFFECT_LABELS[k] for k in self.effect_keys])
        cb.grid(row=0, column=1, sticky="ew", padx=6)
        cb.bind("<<ComboboxSelected>>", lambda e: self.on_effect())

        colors = ttk.Frame(fx)
        colors.grid(row=1, column=0, columnspan=2, sticky="w", pady=6)
        self.c1 = tk.Button(colors, text="主色", width=10, command=lambda: self.pick("color"))
        self.c2 = tk.Button(colors, text="副色", width=10, command=lambda: self.pick("color2"))
        self.c1.pack(side="left")
        self.c2.pack(side="left", padx=6)
        for name, hexv in [("红", "#FF0000"), ("绿", "#00FF00"), ("蓝", "#0040FF"),
                           ("白", "#FFFFFF"), ("紫", "#A020F0"), ("粉", "#FF4080")]:
            tk.Button(colors, text=name, width=3, bg=hexv,
                      command=lambda h=hexv: self.set_color("color", h)).pack(side="left", padx=1)
        self.refresh_color_buttons()

        ttk.Label(fx, text="速度").grid(row=2, column=0, sticky="w")
        self.speed = tk.DoubleVar(value=cfg.speed)
        ttk.Scale(fx, from_=0.1, to=5.0, variable=self.speed,
                  command=lambda v: self.engine.update(speed=float(v))).grid(row=2, column=1, sticky="ew", padx=6)

        ttk.Label(fx, text="亮度").grid(row=3, column=0, sticky="w")
        self.bright = tk.DoubleVar(value=cfg.brightness)
        ttk.Scale(fx, from_=0.0, to=1.0, variable=self.bright,
                  command=lambda v: self.engine.update(brightness=float(v))).grid(row=3, column=1, sticky="ew", padx=6)

        gf = ttk.Frame(fx)
        gf.grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))
        ttk.Label(gf, text="显卡颜色取风扇灯带第").pack(side="left")
        self.follow = tk.IntVar(value=cfg.gpu_follows_led + 1)
        ttk.Spinbox(gf, from_=1, to=240, width=5, textvariable=self.follow,
                    command=self.on_follow).pack(side="left", padx=4)
        ttk.Label(gf, text="颗（彩虹/流星时可让显卡接在风扇灯带后面）").pack(side="left")

        # ---- 按钮 ----
        btns = ttk.Frame(main)
        btns.pack(fill="x")
        ttk.Button(btns, text="重新检测设备", command=self.detect).pack(side="left")
        ttk.Button(btns, text="写入硬件（关程序后保持当前主色）", command=self.save_hw).pack(side="left", padx=6)
        ttk.Button(btns, text="全部关灯", command=lambda: self.set_effect("off")).pack(side="left")

        # ---- 日志 ----
        lf = ttk.LabelFrame(main, text="日志", padding=4)
        lf.pack(fill="both", expand=True, pady=(8, 0))
        self.logbox = tk.Text(lf, height=8, state="disabled", wrap="word")
        self.logbox.pack(fill="both", expand=True)

        self.detect()
        self.engine.start()
        self.root.after(80, self.tick)

    # ---------- 设备行 ----------
    def detect(self) -> None:
        self.engine.stop()
        self.engine.detect(mock=self.mock)
        for w in self.dev_frame.winfo_children():
            w.destroy()
        self.rows.clear()
        if not self.engine.targets:
            ttk.Label(self.dev_frame, text="未检测到设备。请先退出 Armoury Crate / iGame Center，"
                                           "用管理员权限运行；详见 README。").pack(anchor="w")
        for i, tg in enumerate(self.engine.targets):
            var = tk.BooleanVar(value=tg.enabled)
            ttk.Checkbutton(self.dev_frame, text=tg.label, variable=var,
                            command=lambda k=tg.key, v=var: self.engine.set_target(k, enabled=v.get())
                            ).grid(row=i * 2, column=0, sticky="w")
            if tg.kind != "gpu":
                lv = tk.IntVar(value=tg.leds)
                f = ttk.Frame(self.dev_frame)
                f.grid(row=i * 2, column=1, sticky="e")
                ttk.Label(f, text="灯数").pack(side="left")
                sb = ttk.Spinbox(f, from_=1, to=240, width=5, textvariable=lv,
                                 command=lambda k=tg.key, v=lv: self.on_leds(k, v))
                sb.pack(side="left", padx=4)
                sb.bind("<Return>", lambda e, k=tg.key, v=lv: self.on_leds(k, v))
                sb.bind("<FocusOut>", lambda e, k=tg.key, v=lv: self.on_leds(k, v))
            cv = tk.Canvas(self.dev_frame, width=PREVIEW_W, height=PREVIEW_H, highlightthickness=0, bg="#111")
            cv.grid(row=i * 2 + 1, column=0, columnspan=2, sticky="w", pady=(0, 6))
            self.rows[tg.key] = cv
        self.engine.start()

    def on_leds(self, key, var) -> None:
        try:
            self.engine.set_target(key, leds=int(var.get()))
        except (tk.TclError, ValueError):
            pass

    # ---------- 灯效 ----------
    def on_effect(self) -> None:
        label = self.effect_var.get()
        for k, v in EFFECT_LABELS.items():
            if v == label:
                self.engine.update(effect=k)

    def set_effect(self, key: str) -> None:
        self.effect_var.set(EFFECT_LABELS[key])
        self.engine.update(effect=key)

    def on_follow(self) -> None:
        try:
            self.engine.update(gpu_follows_led=max(0, int(self.follow.get()) - 1))
        except (tk.TclError, ValueError):
            pass

    def pick(self, field: str) -> None:
        _, hexv = colorchooser.askcolor(getattr(self.cfg, field), title="选择颜色")
        if hexv:
            self.set_color(field, hexv)

    def set_color(self, field: str, hexv: str) -> None:
        self.engine.update(**{field: hexv.upper()})
        self.refresh_color_buttons()

    def refresh_color_buttons(self) -> None:
        for btn, hexv in ((self.c1, self.cfg.color), (self.c2, self.cfg.color2)):
            r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
            btn.configure(bg=hexv, fg="black" if r * 0.3 + g * 0.59 + b * 0.11 > 128 else "white")

    def save_hw(self) -> None:
        self.engine.save_to_hardware()

    # ---------- 循环 ----------
    def tick(self) -> None:
        frame = self.engine.frame
        for key, cv in self.rows.items():
            colors = frame.get(key)
            cv.delete("all")
            if not colors:
                cv.create_text(6, PREVIEW_H // 2, anchor="w", text="（未启用）", fill="#777")
                continue
            w = PREVIEW_W / len(colors)
            for i, c in enumerate(colors):
                cv.create_rectangle(i * w, 0, (i + 1) * w - (1 if w > 3 else 0), PREVIEW_H,
                                    fill=to_hex(c), outline="")
        try:
            while True:
                msg = self.logq.get_nowait()
                self.logbox.configure(state="normal")
                self.logbox.insert("end", msg + "\n")
                self.logbox.see("end")
                self.logbox.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(80, self.tick)

    def on_close(self) -> None:
        try:
            self.cfg.save()
        except OSError as e:
            messagebox.showwarning("保存配置失败", str(e))
        self.engine.shutdown()
        self.root.destroy()


def run(cfg: Config, mock: bool = False) -> None:
    root = tk.Tk()
    App(root, cfg, mock)
    root.mainloop()
