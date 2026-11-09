import unittest

from rgbsync import aura, colorful
from rgbsync.config import Config
from rgbsync.engine import SyncEngine
from rgbsync.mock import MockHid, MockI2C


class AuraPackets(unittest.TestCase):
    def test_direct_split_45_leds(self):
        colors = [(i, 2 * i, 3 * i) for i in range(45)]
        pkts = aura.direct_packets(1, colors)
        self.assertEqual([len(p) for p in pkts], [65, 65, 65])
        self.assertEqual([p[:5] for p in pkts], [
            bytes([0xEC, 0x40, 0x01, 0, 20]),
            bytes([0xEC, 0x40, 0x01, 20, 20]),
            bytes([0xEC, 0x40, 0x81, 40, 5]),   # 最后一包带 0x80 生效标志
        ])
        self.assertEqual(pkts[2][5:8], bytes([40, 80, 120]))  # 第 41 颗灯，RGB 顺序
        self.assertEqual(pkts[2][20:], bytes(45))

    def test_zones_from_config(self):
        mb = aura.AuraMainboard(MockHid(argb_headers=3, mainboard_leds=4))
        self.assertEqual(mb.firmware, "AULA3-MOCK-0001")
        self.assertEqual([(z.kind, z.effect_channel, z.direct_channel) for z in mb.zones], [
            ("fixed", 0, 4), ("addressable", 1, 0), ("addressable", 2, 1), ("addressable", 3, 2)])
        # AULA3-AR32 固件：ARGB 灯效通道从 0 开始
        mb2 = aura.AuraMainboard(MockHid(argb_headers=2, mainboard_leds=4, firmware="AULA3-AR32-0207"))
        self.assertEqual([z.effect_channel for z in mb2.zones], [2, 0, 1])

    def test_set_mode_static_and_commit(self):
        hid = MockHid(argb_headers=2)
        mb = aura.AuraMainboard(hid)
        hid.written.clear()
        mb.set_mode(mb.zones[1], aura.MODE_STATIC, (255, 0, 0), save=True)
        eff, col, com = hid.written
        self.assertEqual(eff[:6], bytes([0xEC, 0x35, 1, 0, 0, 1]))
        self.assertEqual(col[:8], bytes([0xEC, 0x36, 0x00, 0x02, 0, 0, 0, 0]))  # mask=bit1 → 第 2 个 LED 槽
        self.assertEqual(col[8:11], bytes([255, 0, 0]))
        self.assertEqual(com[:3], bytes([0xEC, 0x3F, 0x55]))


class ColorfulPackets(unittest.TestCase):
    def test_v1_red_checksum(self):
        self.assertEqual(colorful.v1_packet((255, 0, 0)).hex(" "),
                         "aa ef 12 03 01 ff ff 00 00 ad 03")

    def test_v2_length(self):
        p = colorful.v2_packet([(1, 2, 3)])
        self.assertEqual(len(p), 122)
        self.assertEqual(p[:9], bytes([0xAA, 0xEF, 0x01, 0x04, 0x88, 0x26, 1, 2, 3]))
        s = sum(p[:-2])
        self.assertEqual(p[-2:], bytes([s & 0xFF, (s >> 8) & 0xFF]))

    def test_dedupe_writes(self):
        bus = MockI2C()
        g = colorful.ColorfulGPU(bus)
        self.assertTrue(g.handshake())
        g.set_colors([(1, 2, 3)])
        g.set_colors([(1, 2, 3)])
        self.assertEqual(len(bus.written), 2)  # 握手 + 一次颜色


class EngineSync(unittest.TestCase):
    def test_gpu_matches_fan_led(self):
        cfg = Config(effect="rainbow_wave", gpu_follows_led=0)
        eng = SyncEngine(cfg, log=lambda m: None)
        eng.detect(mock=True)
        frame = eng.render_frame(1.234)
        fan = next(t for t in eng.targets if t.kind == "fan")
        gpu = next(t for t in eng.targets if t.kind == "gpu")
        self.assertEqual(len(frame[fan.key]), 30)
        self.assertEqual(frame[gpu.key], [frame[fan.key][0]])

    def test_step_writes_both_devices(self):
        eng = SyncEngine(Config(effect="static", color="#00FF00"), log=lambda m: None)
        eng.detect(mock=True)
        hid = eng.mainboards[0].dev
        i2c = eng.gpus[0].bus
        hid.written.clear(); i2c.written.clear()
        self.assertTrue(eng.step(0))
        self.assertTrue(any(p[1] == 0x40 and p[5:8] == bytes([0, 255, 0]) for p in hid.written))
        self.assertEqual(i2c.written[-1][1], colorful.v1_packet((0, 255, 0)))
        self.assertFalse(eng.step(0.1))  # 静态且没变化，不重复写


if __name__ == "__main__":
    unittest.main()
