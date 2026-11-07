import { db, uid, type Frame } from '../db/schema';
import { compressImage } from './image';

/** 底片处理参数：反相 / 去色罩 / 曝光 / 对比 / 色温 / 饱和 / 旋转翻转 */
export type DevMode = 'color-neg' | 'bw-neg' | 'positive';

export interface DevParams {
  mode: DevMode;
  /** 反相后每通道的黑点 / 白点（0-255），由「自动校正」算出；彩色负片靠它抵消橙色片基 */
  lo: number[];
  hi: number[];
  exposure: number; // -100..100，±2EV
  contrast: number; // -100..100
  temp: number; // -100..100，正值偏暖
  saturation: number; // -100..100
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
}

export const DEV_MODE_LABEL: Record<DevMode, string> = {
  'color-neg': '彩色负片',
  'bw-neg': '黑白负片',
  positive: '已是正片',
};

export const IDENTITY: DevParams = {
  mode: 'positive', lo: [0, 0, 0], hi: [255, 255, 255], exposure: 0, contrast: 0, temp: 0, saturation: 0, rotate: 0, flip: false,
};

export function defaultMode(stockType?: string): DevMode {
  if (stockType === 'bw') return 'bw-neg';
  if (stockType === 'slide') return 'positive';
  return 'color-neg';
}

const isNeg = (m: DevMode) => m !== 'positive';

/** 就地处理像素（RGBA）。 */
export function developInPlace(d: Uint8ClampedArray, p: DevParams): void {
  const neg = isNeg(p.mode);
  const bw = p.mode === 'bw-neg';
  const ev = Math.pow(2, p.exposure / 50);
  const ct = 1 + p.contrast / 100;
  const rm = 1 + p.temp / 250, bm = 1 - p.temp / 250;
  const sat = 1 + p.saturation / 100;
  const sc = [0, 1, 2].map((i) => 1 / Math.max(8, (p.hi[i] ?? 255) - (p.lo[i] ?? 0)));
  const lo = [p.lo[0] ?? 0, p.lo[1] ?? 0, p.lo[2] ?? 0];
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (neg) { r = 255 - r; g = 255 - g; b = 255 - b; }
    if (bw) { r = g = b = 0.299 * r + 0.587 * g + 0.114 * b; }
    r = (r - lo[0]) * sc[0]; g = (g - lo[1]) * sc[1]; b = (b - lo[2]) * sc[2];
    r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
    r *= ev * rm; g *= ev; b *= ev * bm;
    r = (r - 0.5) * ct + 0.5; g = (g - 0.5) * ct + 0.5; b = (b - 0.5) * ct + 0.5;
    if (sat !== 1 && !bw) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255; // Uint8ClampedArray 自动截断
  }
}

/** 统计反相后的 0.4% / 99.6% 分位，作为黑白点。彩色负片逐通道拉伸，就能去掉橙色片基。 */
export function computeLevels(d: Uint8ClampedArray, mode: DevMode): { lo: number[]; hi: number[] } {
  const neg = isNeg(mode);
  const n = d.length / 4;
  const step = Math.max(1, Math.floor(n / 250000));
  const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let cnt = 0;
  for (let k = 0; k < n; k += step) {
    const i = k * 4;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (neg) { r = 255 - r; g = 255 - g; b = 255 - b; }
    if (mode === 'bw-neg') { r = g = b = Math.round(0.299 * r + 0.587 * g + 0.114 * b); }
    H[0][r]++; H[1][g]++; H[2][b]++; cnt++;
  }
  const pct = (h: Uint32Array, q: number) => {
    const t = cnt * q; let s = 0;
    for (let v = 0; v < 256; v++) { s += h[v]; if (s >= t) return v; }
    return 255;
  };
  const lo = H.map((h) => pct(h, 0.004));
  const hi = H.map((h) => pct(h, 0.996));
  for (let i = 0; i < 3; i++) {
    if (hi[i] - lo[i] < 24) { const m = (hi[i] + lo[i]) / 2; lo[i] = Math.max(0, m - 12); hi[i] = Math.min(255, m + 12); }
  }
  return { lo, hi };
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

const MAX_OUT = 6000;

/** 把处理应用到一张扫描件：保留原图（origPhotoId），生成新的查看图和缩略图。auto=true 时对这张图重新算黑白点。 */
export async function developFrame(frame: Frame, params: DevParams, auto: boolean): Promise<DevParams> {
  const origId = frame.origPhotoId ?? frame.photoId;
  const orig = await db.photos.get(origId);
  if (!orig) throw new Error('找不到原图');
  const bmp = await createImageBitmap(orig.blob);
  const img = rasterize(bmp, params.rotate, params.flip, MAX_OUT);
  bmp.close?.();
  const used = { ...params, ...(auto && params.mode !== 'positive' ? computeLevels(img.data, params.mode) : {}) };
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
