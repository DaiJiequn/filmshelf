import { describe, expect, it } from 'vitest';
import { autoAnalyze, developInPlace, DEFAULT_GLOSS, IDENTITY, type DevParams } from './develop';

const enc = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));

/** 模拟一张彩色负片：场景灰阶（线性光）经 H&D 曲线变成透射率，乘上橙色片基，再编码为 sRGB。四周留一圈片基。 */
function fakeNegative(w = 64, h = 40) {
  const base = [0.62, 0.36, 0.17]; // 橙色片基（线性光）
  const gam = [0.55, 0.62, 0.7];
  const data = new Uint8ClampedArray(w * h * 4);
  const scene: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const border = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
    const L = 0.02 + (0.9 * (x - 3)) / (w - 6); // 场景从暗到亮
    for (let c = 0; c < 3; c++) {
      const T = border ? base[c] : base[c] * Math.pow(10, -gam[c] * Math.log10(Math.max(L, 0.01) / 0.01));
      data[i + c] = enc(Math.min(1, T));
    }
    data[i + 3] = 255;
    if (!border && y === 20) scene.push(L);
  }
  return { data, w, h, base };
}

describe('底片处理 v2', () => {
  it('正片模式 + 默认参数不改变像素', () => {
    const d = new Uint8ClampedArray([10, 120, 250, 255]);
    developInPlace(d, IDENTITY);
    for (let i = 0; i < 3; i++) expect(Math.abs(d[i] - [10, 120, 250][i])).toBeLessThanOrEqual(1);
  });

  it('自动估计的片基接近真实片基（来自边框）', () => {
    const { data, w, h, base } = fakeNegative();
    const a = autoAnalyze({ data, width: w, height: h }, 'color-neg');
    for (let c = 0; c < 3; c++) expect(Math.abs(a.base[c] - base[c]) / base[c]).toBeLessThan(0.05);
  });

  it('彩负反相后：片基变黑，灰阶接近中性，且随场景亮度单调上升', () => {
    const { data, w, h } = fakeNegative();
    const a = autoAnalyze({ data, width: w, height: h }, 'color-neg');
    const p: DevParams = { ...IDENTITY, mode: 'color-neg', ...a, gloss: DEFAULT_GLOSS };
    developInPlace(data, p);
    const px = (x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    const border = px(0, 0);
    expect(Math.max(...border)).toBeLessThan(12);
    let prev = -1;
    for (let x = 6; x < w - 6; x += 6) {
      const [r, g, b] = px(x, 20);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(26); // 近似中性
      expect(r + g + b).toBeGreaterThanOrEqual(prev - 3);
      prev = r + g + b;
    }
  });

  it('黑白负片输出灰度', () => {
    const d = new Uint8ClampedArray([200, 180, 160, 255]);
    developInPlace(d, { ...IDENTITY, mode: 'bw-neg', base: [0.9, 0.9, 0.9], lo: [0, 0, 0], hi: [1, 1, 1] });
    expect(d[0]).toBe(d[1]); expect(d[1]).toBe(d[2]);
  });

  it('纸号越高对比越强；曝光为正更亮', () => {
    const mk = (over: Partial<DevParams>) => { const d = new Uint8ClampedArray([128, 128, 128, 255]); developInPlace(d, { ...IDENTITY, ...over }); return d[0]; };
    expect(mk({ exposure: 50 })).toBeGreaterThan(mk({}));
    expect(mk({ grade: 60 })).toBeLessThan(mk({}));
  });
});
