"""颜色工具。颜色统一用 (r, g, b) 三元组，0-255。"""

import colorsys

RGB = tuple  # (r, g, b)

BLACK = (0, 0, 0)


def parse_hex(text: str) -> RGB:
    s = text.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        raise ValueError(f"颜色格式错误：{text!r}，应为 #RRGGBB")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def to_hex(c: RGB) -> str:
    return "#%02X%02X%02X" % tuple(c)


def scale(c: RGB, k: float) -> RGB:
    k = max(0.0, min(1.0, k))
    return (int(round(c[0] * k)), int(round(c[1] * k)), int(round(c[2] * k)))


def hsv(h: float, s: float = 1.0, v: float = 1.0) -> RGB:
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v)
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))
