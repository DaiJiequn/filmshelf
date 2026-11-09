# RGB Sync

同时控制两类灯光，用同一个时钟驱动，所以两边的灯效是同步的：

| 设备 | 链路 | 协议 |
|---|---|---|
| 乔思伯 SL-120W ARGB 风扇（插在华硕主板 5V ARGB 接口上） | USB HID → 华硕 Aura 主板控制器（VID 0B05） | Aura USB：`EC 35`/`EC 36`/`EC 3F`/`EC 40` |
| 七彩虹 iGame RTX 5080 Ultra | NvAPI（Windows）或 i2c-dev（Linux）→ 显卡 I²C 地址 0x61 | `AA EF ...` + 16 位求和校验 |

协议来自 OpenRGB 的逆向成果，本程序是用 Python 重新实现的。

## 安装

```bat
:: Windows：Python 3.10+（官方安装包自带 tkinter）
pip install -r requirements.txt
python run_gui.py
```

先不接硬件试界面：`python -m rgbsync --mock`

## 使用前必须做

1. **退出 Armoury Crate 和 iGame Center**，并在“服务”里停用 `LightingService`。两个程序同时写灯控芯片会互相覆盖，甚至导致设备打不开。
2. 用**管理员权限**运行。显卡的 I²C 访问需要管理员权限。
3. 风扇只能接 **5V 3 针 ARGB 接口**，千万别接 12V 4 针 RGB 接口。

## 功能

- 设备列表：勾选参与同步的设备，带实时颜色预览。
- 灯效：静态、呼吸、色彩循环、彩虹波浪、双色渐变、流星追逐、关灯，可调速度和亮度。
- **数灯模式**：所有灯暗白，最后一颗亮红。逐步调大“灯数”，直到再加一颗时红灯不再出现，这时的数值就是这个接口上的实际灯数（串联多把风扇时是总数）。
- 显卡颜色可以取风扇灯带第 N 颗的颜色。比如设成“总灯数 + 1”，彩虹或流星效果就像一条灯带从风扇延续到显卡。
- **写入硬件**：把当前主色以静态模式写进主板（`EC 3F 55` 保存）和显卡，关掉程序后保持。动态灯效需要程序一直运行。
- 设置保存在 `~/.rgbsync.json`。

## 命令行

```
python -m rgbsync detect                       # 检测设备
python -m rgbsync set "#FF6600"                # 全部设为橙色并写入硬件
python -m rgbsync run rainbow_wave --leds 24   # 后台跑彩虹（Ctrl+C 退出）
python -m rgbsync off                          # 全部关灯
python -m rgbsync --gpu-protocol v2 ...        # 显卡改用 122 字节逐区包
python -m rgbsync --gpu-any-vendor detect      # 子厂商 ID 不是 7377 时强制握手
```

## 打包 exe

`build_exe.bat` 会生成 `dist\RGBSync.exe`，启动时自动请求管理员权限。要开机自启，把快捷方式放进 `shell:startup`。

## 已知限制 / 排错

- **RTX 5080 Ultra 没人实测过。** 同系列的 5060 Ultra W 已确认是 0x61 地址加 V1 包。如果日志显示“0x61 无七彩虹灯控应答”，可以：
  - 确认 GPU-Z 里显示的子系统 ID 是 `7377:xxxx`；
  - 试一下 `--gpu-protocol v2`；
  - 用 iGame Center 切换灯效时抓 I²C 包，对照一下实际格式。
- 读不到 Aura 配置表，基本都是被 Armoury Crate 占用了。
- 不同主板的 ARGB 通道编号可能不一样，程序会按配置表推算。如果灯亮在别的接口上，换勾选另一个“ARGB 接口”就行。
- Linux：先 `sudo modprobe i2c-dev`，用 root 运行，或者把用户加进 i2c 组，再配好 hidraw 的 udev 规则。

## 测试

```
python -m unittest discover -s tests
```

测试用虚拟设备逐字节核对协议包：Aura Direct 的分包和生效标志、配置表推算、显卡校验和、风扇与显卡的同步。
