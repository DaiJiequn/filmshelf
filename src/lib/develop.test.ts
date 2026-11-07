import { describe, expect, it } from 'vitest';
import { computeLevels, developInPlace, IDENTITY } from './develop';

describe('底片处理', () => {
  it('正片模式 + 默认参数不改变像素', () => {
    const d = new Uint8ClampedArray([10, 120, 250, 255]);
    developInPlace(d, IDENTITY);
    expect(Array.from(d)).toEqual([10, 120, 250, 255]);
  });
  it('反相并按通道拉伸：橙色片基被抵消成中性色', () => {
    // 模拟彩负：片基橙色 (230,140,80)，景物亮部更暗
    const d = new Uint8ClampedArray([230, 140, 80, 255, 120, 70, 40, 255, 20, 10, 5, 255]);
    const lv = computeLevels(d, 'color-neg');
    const p = { ...IDENTITY, mode: 'color-neg' as const, ...lv };
    developInPlace(d, p);
    // 片基 → 黑；最暗处 → 白
    expect(d[0]).toBeLessThan(8); expect(d[1]).toBeLessThan(8); expect(d[2]).toBeLessThan(8);
    expect(d[8]).toBeGreaterThan(247); expect(d[9]).toBeGreaterThan(247); expect(d[10]).toBeGreaterThan(247);
  });
  it('黑白负片输出灰度', () => {
    const d = new Uint8ClampedArray([200, 180, 160, 255]);
    developInPlace(d, { ...IDENTITY, mode: 'bw-neg', lo: [0, 0, 0], hi: [255, 255, 255] });
    expect(d[0]).toBe(d[1]); expect(d[1]).toBe(d[2]);
  });
});
