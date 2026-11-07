import { db, uid, type Frame } from '../db/schema';
import { compressImage } from './image';

/**
 * 底片处理（v2）——参考 darktable negadoctor 的“密度空间 + 模拟放大机印相”流程，
 * 片基估计与逐通道反相的思路参考 invers（MIT）与 NegPy 的整卷归一化。本文件为独立的 JS 实现，未复制任何 GPL 代码。
 *
 * 流程（负片）：sRGB → 线性光 → 密度 D=-log10(T/片基) → 按黑白点归一化 → 阴影/高光逐通道修正
 *               → 印相（曝光、黑位、纸号 gamma、高光压缩）→ 输出
 */
export type DevMode = 'color-neg' | 'bw-neg' | 'positive';

export interface DevParams {
  v: 2;
  mode: DevMode;
  /** 片基颜色（线性光 0-1，每通道）。黑白负片三个值相同。 */
  base: number[];
  /** 自动算出的密度黑点 / 白点（每通道）。逐通道拉伸 = 抵消片基与各层感光差异 */
  lo: number[];
  hi: number[];
  exposure: number; // 印相曝光 -100..100（±2EV）
  grade: number; // 纸号（对比）-100..100，gamma = 2^(grade/100)
  paperBlack: number; // 黑位 -100..100，正值提亮暗部
  gloss: number; // 高光压缩 0..100
  white: number; // 白点（Dmax）-100..100，正值整体变暗
  black: number; // 黑点（扫描曝光偏置）-100..100，正值压暗阴影
  saturation: number; // -100..100
  shadow: number[]; // 阴影偏色 R/G/B -100..100
  highlight: number[]; // 高光偏色 R/G/B -100..100（乘数）
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
}

export const DEV_MODE_LABEL: Record<DevMode, string> = {
  'color-neg': '彩色负片',
  'bw-neg': '黑白负片',
  positive: '已是正片',
};

export const IDENTITY: DevParams = {
  v: 2, mode: 'positive', base: [1, 1, 1], lo: [0, 0, 0], hi: [1, 1, 1],
  exposure: 0, grade: 0, paperBlack: 0, gloss: 0, white: 0, black: 0, saturation: 0,
  shadow: [0, 0, 0], highlight: [0, 0, 0], rotate: 0, flip: false,
};

export function defaultMode(stockType?: string): DevMode {
  if (stockType === 'bw') return 'bw-neg';
  if (stockType === 'slide') return 'positive';
  return 'color-neg';
}

export const DEFAULT_GLOSS = 25;
const isNeg = (m: DevMode) => m !== 'positive';

const SRGB_LIN = new Float32Array(256); // 8 位 sRGB → 线性光
const LN_LIN = new Float32Array(256); // ln(线性光)，下限 1e-4 避免 -∞
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  LN_LIN[i] = Math.log(Math.max(SRGB_LIN[i], 1e-4));
}
const INV_LN10 = 1 / Math.LN10;

/** 印相曲线：x=归一化密度×曝光+黑位 → 纸号 gamma → 高光压缩 → 0..1，预先算成查表 */
function toneLut(p: DevParams): Uint8ClampedArray {
  const N = 4096, MAXX = 2;
  const out = new Uint8ClampedArray(N + 1);
  const gm = Math.pow(2, p.grade / 100); // 纸号越高 → 指数越大 → 对比越强
  const g = p.gloss / 100;
  const t = 1 - 0.5 * g;
  for (let i = 0; i <= N; i++) {
    let v = Math.pow((i / N) * MAXX, gm);
    if (g > 0 && v > t) v = t + (1 - t) * Math.tanh((v - t) / (1 - t));
    out[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return out;
}

/** 就地处理像素（RGBA） */
export function developInPlace(d: Uint8ClampedArray, p: DevParams): void {
  const neg = isNeg(p.mode);
  const bw = p.mode === 'bw-neg';
  const ev = Math.pow(2, p.exposure / 50);
  const pb = (p.paperBlack / 100) * 0.08;
  const sat = 1 + p.saturation / 100;
  const lut = toneLut(p);
  const K = 4096 / 2;
  const lnBase = p.base.map((b) => Math.log(Math.max(b, 1e-4)));
  const black: number[] = [], inv: number[] = [];
  for (let c = 0; c < 3; c++) {
    const span = Math.max(0.05, p.hi[c] - p.lo[c]);
    const bk = p.lo[c] + (p.black / 100) * 0.25 * span;
    const wh = p.hi[c] + (p.white / 100) * 0.5 * span;
    black.push(bk);
    inv.push(1 / Math.max(0.02, wh - bk));
  }
  const sh = p.shadow.map((x) => (x / 100) * 0.15);
  const hl = p.highlight.map((x) => 1 + x / 100);
  const v = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (neg) {
      if (bw) {
        const y = 0.2126 * SRGB_LIN[d[i]] + 0.7152 * SRGB_LIN[d[i + 1]] + 0.0722 * SRGB_LIN[d[i + 2]];
        const dd = (lnBase[0] - Math.log(Math.max(y, 1e-4))) * INV_LN10;
        v[0] = v[1] = v[2] = (dd - black[0]) * inv[0];
      } else {
        v[0] = ((lnBase[0] - LN_LIN[d[i]]) * INV_LN10 - black[0]) * inv[0];
        v[1] = ((lnBase[1] - LN_LIN[d[i + 1]]) * INV_LN10 - black[1]) * inv[1];
        v[2] = ((lnBase[2] - LN_LIN[d[i + 2]]) * INV_LN10 - black[2]) * inv[2];
      }
    } else {
      v[0] = d[i] / 255; v[1] = d[i + 1] / 255; v[2] = d[i + 2] / 255;
    }
    for (let c = 0; c < 3; c++) {
      let n = v[c] < 0 ? 0 : v[c];
      n = (n + sh[c] * (1 - (n > 1 ? 1 : n))) * hl[c];
      let x = n * ev + pb;
      x = x < 0 ? 0 : x > 2 ? 2 : x;
      v[c] = lut[(x * K + 0.5) | 0] / 255;
    }
    if (sat !== 1 && !bw) {
      const l = 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
      v[0] = l + (v[0] - l) * sat; v[1] = l + (v[1] - l) * sat; v[2] = l + (v[2] - l) * sat;
    }
    d[i] = v[0] * 255; d[i + 1] = v[1] * 255; d[i + 2] = v[2] * 255;
  }
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
const lumOf = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** 估计片基（线性光）。先看边框 / 四角里最亮的、带橙色倾向（R>G>B）的区域；找不到就退回到全图最亮 0.2% 的各通道值 */
export function estimateBase(img: { data: Uint8ClampedArray; width: number; height: number }, mode: DevMode): number[] {
  const { data, width: w, height: h } = img;
  const region = (x0: number, y0: number, x1: number, y1: number): number[] => {
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    const st = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
    for (let y = y0; y < y1; y += st) for (let x = x0; x < x1; x += st) {
      const i = (y * w + x) * 4;
      rs.push(SRGB_LIN[data[i]]); gs.push(SRGB_LIN[data[i + 1]]); bs.push(SRGB_LIN[data[i + 2]]);
    }
    return [median(rs), median(gs), median(bs)];
  };
  // 全图各通道 99.8 分位作为兜底
  const n = w * h, step = Math.max(1, Math.floor(n / 200000));
  const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let cnt = 0;
  for (let k = 0; k < n; k += step) { const i = k * 4; H[0][data[i]]++; H[1][data[i + 1]]++; H[2][data[i + 2]]++; cnt++; }
  const top = H.map((hh) => { let s = 0; for (let v = 255; v >= 0; v--) { s += hh[v]; if (s >= cnt * 0.002) return SRGB_LIN[v]; } return 1; });
  const fallback = mode === 'bw-neg' ? Array(3).fill(lumOf(top)) : top;

  const bx = Math.max(2, Math.round(w * 0.03)), by = Math.max(2, Math.round(h * 0.03));
  const cands = [
    region(0, 0, w, by), region(0, h - by, w, h), region(0, 0, bx, h), region(w - bx, 0, w, h),
    region(0, 0, bx * 3, by * 3), region(w - bx * 3, 0, w, by * 3), region(0, h - by * 3, bx * 3, h), region(w - bx * 3, h - by * 3, w, h),
  ];
  let best: number[] | null = null;
  for (const c of cands) {
    if (lumOf(c) < 0.85 * lumOf(top)) continue; // 比全图最亮处暗太多，不像片基
    if (mode === 'color-neg' && !(c[0] > c[1] && c[1] > c[2])) continue; // 橙色片基：R>G>B
    if (!best || lumOf(c) > lumOf(best)) best = c;
  }
  if (!best) return fallback;
  return mode === 'bw-neg' ? Array(3).fill(lumOf(best)) : best;
}

/** 给定片基，统计密度的 0.4% / 99.6% 分位作为黑白点（彩色逐通道，黑白共用） */
export function computeLevels(img: { data: Uint8ClampedArray }, mode: DevMode, base: number[]): { lo: number[]; hi: number[] } {
  if (!isNeg(mode)) return { lo: [0, 0, 0], hi: [1, 1, 1] };
  const d = img.data;
  const n = d.length / 4, step = Math.max(1, Math.floor(n / 250000));
  const lnBase = base.map((b) => Math.log(Math.max(b, 1e-4)));
  const bins = 2048, DMAX = 4;
  const H = [new Uint32Array(bins), new Uint32Array(bins), new Uint32Array(bins)];
  let cnt = 0;
  const put = (c: number, dd: number) => { const k = Math.min(bins - 1, Math.max(0, Math.floor((dd / DMAX) * bins))); H[c][k]++; };
  for (let k = 0; k < n; k += step) {
    const i = k * 4;
    if (mode === 'bw-neg') {
      const y = 0.2126 * SRGB_LIN[d[i]] + 0.7152 * SRGB_LIN[d[i + 1]] + 0.0722 * SRGB_LIN[d[i + 2]];
      put(0, (lnBase[0] - Math.log(Math.max(y, 1e-4))) * INV_LN10);
    } else {
      put(0, (lnBase[0] - LN_LIN[d[i]]) * INV_LN10);
      put(1, (lnBase[1] - LN_LIN[d[i + 1]]) * INV_LN10);
      put(2, (lnBase[2] - LN_LIN[d[i + 2]]) * INV_LN10);
    }
    cnt++;
  }
  const pct = (h: Uint32Array, q: number) => { const t = cnt * q; let s = 0; for (let b = 0; b < bins; b++) { s += h[b]; if (s >= t) return ((b + 0.5) / bins) * DMAX; } return DMAX; };
  let lo: number[], hi: number[];
  if (mode === 'bw-neg') { lo = Array(3).fill(pct(H[0], 0.004)); hi = Array(3).fill(pct(H[0], 0.996)); }
  else { lo = H.map((h) => pct(h, 0.004)); hi = H.map((h) => pct(h, 0.996)); }
  for (let c = 0; c < 3; c++) if (hi[c] - lo[c] < 0.15) { const m = (hi[c] + lo[c]) / 2; lo[c] = m - 0.075; hi[c] = m + 0.075; }
  return { lo, hi };
}

/** 自动校正：片基 + 黑白点 */
export function autoAnalyze(img: { data: Uint8ClampedArray; width: number; height: number }, mode: DevMode): { base: number[]; lo: number[]; hi: number[] } {
  if (!isNeg(mode)) return { base: [1, 1, 1], lo: [0, 0, 0], hi: [1, 1, 1] };
  const base = estimateBase(img, mode);
  return { base, ...computeLevels(img, mode, base) };
}

/** 取图上一小块的平均线性光（用来点选片基） */
export function sampleLinear(img: ImageData, x: number, y: number, r = 3): number[] {
  const acc = [0, 0, 0]; let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(img.height - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(img.width - 1, x + r); xx++) {
    const i = (yy * img.width + xx) * 4;
    acc[0] += SRGB_LIN[img.data[i]]; acc[1] += SRGB_LIN[img.data[i + 1]]; acc[2] += SRGB_LIN[img.data[i + 2]]; n++;
  }
  return acc.map((v) => v / Math.max(1, n));
}

/** 按旋转/翻转把图画到画布，返回像素。maxSide 限制最长边。 */
export function rasterize(bmp: ImageBitmap, rotate: number, flip: boolean, maxSide: number): ImageData {
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const dw = Math.max(1, Math.round(bmp.width * k)), dh = Math.max(1, Math.round(bmp.height * k));
  const swap = rotate === 90 || rotate === 270;
  const c = document.createElement('canvas');
  c.width = swap ? dh : dw; c.height = swap ? dw : dh;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** 整卷分析：每张取片基和黑白点，再取各通道中位数，让整卷颜色和影调一致（思路来自 NegPy 的批量归一化） */
export async function analyzeRoll(frames: Frame[], mode: DevMode): Promise<{ base: number[]; lo: number[]; hi: number[] }> {
  const all: { base: number[]; lo: number[]; hi: number[] }[] = [];
  for (const f of frames) {
    const orig = await db.photos.get(f.origPhotoId ?? f.photoId);
    if (!orig) continue;
    const bmp = await createImageBitmap(orig.blob);
    const img = rasterize(bmp, 0, false, 1000);
    bmp.close?.();
    all.push(autoAnalyze(img, mode));
  }
  if (!all.length) throw new Error('没有可分析的图');
  const m = (k: 'base' | 'lo' | 'hi') => [0, 1, 2].map((c) => median(all.map((a) => a[k][c])));
  return { base: m('base'), lo: m('lo'), hi: m('hi') };
}

const MAX_OUT = 6000;

/** 把处理应用到一张扫描件：保留原图（origPhotoId），生成新的查看图和缩略图。 */
export async function developFrame(frame: Frame, params: DevParams): Promise<DevParams> {
  const origId = frame.origPhotoId ?? frame.photoId;
  const orig = await db.photos.get(origId);
  if (!orig) throw new Error('找不到原图');
  const bmp = await createImageBitmap(orig.blob);
  const img = rasterize(bmp, params.rotate, params.flip, MAX_OUT);
  bmp.close?.();
  const used = params;
  developInPlace(img.data, used);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('导出失败'))), 'image/jpeg', 0.92));
  const thumb = await compressImage(blob, 480, 0.8);
  const photoId = uid(), thumbId = uid();
  const cur = await db.frames.get(frame.id);
  if (!cur) throw new Error('这张已被删除');
  await db.transaction('rw', db.photos, db.frames, async () => {
    await db.photos.bulkAdd([
      { id: photoId, blob, width: img.width, height: img.height },
      { id: thumbId, blob: thumb.blob, width: thumb.width, height: thumb.height },
    ]);
    // 旧的处理版本和旧缩略图删掉；原图永远保留
    const stale = [cur.thumbId, ...(cur.origPhotoId ? [cur.photoId] : [])];
    await db.photos.bulkDelete(stale);
    await db.frames.update(frame.id, { photoId, thumbId, width: img.width, height: img.height, origPhotoId: origId, edit: used });
  });
  return used;
}

/** 还原成导入时的原图 */
export async function revertFrame(frame: Frame): Promise<void> {
  const cur = await db.frames.get(frame.id);
  if (!cur?.origPhotoId) return;
  const orig = await db.photos.get(cur.origPhotoId);
  if (!orig) throw new Error('找不到原图');
  const thumb = await compressImage(orig.blob, 480, 0.8);
  const thumbId = uid();
  await db.transaction('rw', db.photos, db.frames, async () => {
    await db.photos.add({ id: thumbId, blob: thumb.blob, width: thumb.width, height: thumb.height });
    await db.photos.bulkDelete([cur.photoId, cur.thumbId]);
    await db.frames.update(frame.id, { photoId: cur.origPhotoId, thumbId, width: orig.width, height: orig.height, origPhotoId: undefined, edit: undefined });
  });
}
