import { describe, expect, it } from 'vitest';
import { detectAngle, detectCrop, edgeIndex, fitAspect } from './crop';

/** 合成一张带橙色片基边框的负片扫描（可旋转 deg 度）：片基亮、画面暗，画面里有渐变。 */
function fake(w: number, h: number, bx: number, by: number, deg = 0) {
  const d = new Uint8ClampedArray(w * h * 4);
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // 反向旋转回到未旋转坐标
    const dx = x - cx, dy = y - cy;
    const u = ca * dx + sa * dy + cx, v = -sa * dx + ca * dy + cy;
    const inside = u >= bx && u < w - bx && v >= by && v < h - by;
    const i = (y * w + x) * 4;
    const val = inside ? 60 + 80 * ((u - bx) / (w - 2 * bx)) : 215; // 负片：片基亮
    d[i] = val; d[i + 1] = val * 0.8; d[i + 2] = val * 0.6; d[i + 3] = 255;
  }
  return { data: d, width: w, height: h };
}

describe('自动裁切', () => {
  it('edgeIndex 找到跃变位置', () => {
    const p = Array.from({ length: 200 }, (_, i) => (i < 30 ? 20 : 120));
    expect(Math.abs((edgeIndex(p, false) ?? -1) - 30)).toBeLessThanOrEqual(3);
    expect(Math.abs((edgeIndex(p.slice().reverse(), true) ?? -1) - 169)).toBeLessThanOrEqual(3);
    expect(edgeIndex(Array(100).fill(50), false)).toBeNull();
  });
  it('检测画面矩形（负片）', () => {
    const img = fake(400, 280, 24, 18);
    const c = detectCrop(img, true)!;
    expect(c).not.toBeNull();
    expect(c.x * 400).toBeGreaterThan(20); expect(c.x * 400).toBeLessThan(36);
    expect(c.y * 280).toBeGreaterThan(14); expect(c.y * 280).toBeLessThan(28);
    expect((c.x + c.w) * 400).toBeLessThan(380); expect((c.x + c.w) * 400).toBeGreaterThan(364);
  });
  it('没有边框时不裁', () => {
    const img = fake(300, 200, 0, 0);
    expect(detectCrop(img, true)).toBeNull();
  });
  it('估计倾斜角', () => {
    for (const deg of [-1.8, 0, 1.2, 2.5]) {
      const a = detectAngle(fake(500, 340, 30, 24, deg), true);
      expect(Math.abs(a - (-deg))).toBeLessThan(0.5); // 返回的是“为了摆正需要旋转的角度”
    }
  });
  it('固定宽高比', () => {
    const c = fitAspect({ x: 0, y: 0, w: 1, h: 1 }, 1.5, 300, 300);
    expect(c.w * 300 / (c.h * 300)).toBeCloseTo(1.5, 2);
  });
});
