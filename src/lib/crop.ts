/**
 * 自动裁切去边框 + 纠偏。思路来自 croppy（MIT, github.com/cgbur/croppy）：
 * 灰度（负片先反相）→ 按行/列求一维亮度曲线 → 从四边往里找“第一个明显的跃变” = 画面边缘 →
 * 对边缘点拟合直线估计倾斜角（上限 ±3°）。本文件为独立的 JS 实现。
 */
export interface Crop { x: number; y: number; w: number; h: number } // 归一化 0..1，相对于（已纠偏的）整图

type Img = { data: Uint8ClampedArray; width: number; height: number };

/** 信号：片基/黑边处最低，画面处更高。负片里片基最亮，所以反相 */
function signal(img: Img, invert: boolean): Float32Array {
  const { data, width: w, height: h } = img;
  const s = new Float32Array(w * h);
  for (let i = 0, k = 0; k < w * h; k++, i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    s[k] = invert ? 255 - g : g;
  }
  return s;
}

/** 在一维曲线上，从一端往里找第一个明显的上升沿。没有足够对比就返回 null */
export function edgeIndex(p: ArrayLike<number>, fromEnd: boolean, frac = 0.3, minStep = 10): number | null {
  const n = p.length;
  const q = fromEnd ? Array.from({ length: n }, (_, i) => p[n - 1 - i]) : Array.from(p as ArrayLike<number>);
  const lim = Math.floor(n * frac), k = Math.max(2, Math.round(n * 0.004));
  const d: number[] = [];
  let maxd = 0;
  for (let i = k; i < lim; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < k; j++) { a += q[i - 1 - j]; b += q[i + j]; }
    const v = (b - a) / k;
    d[i] = v;
    if (v > maxd) maxd = v;
  }
  if (maxd < minStep) return null;
  const thr = maxd * 0.5;
  let i = k;
  while (i < lim && !(d[i] >= thr)) i++;
  if (i >= lim) return null;
  // 爬到这个跃变的峰值位置
  let best = i;
  for (let j = i; j < Math.min(lim, i + k * 3); j++) if (d[j] > d[best]) best = j;
  return fromEnd ? n - 1 - best : best;
}

function colProfile(s: Float32Array, w: number, h: number, y0: number, y1: number): Float32Array {
  const p = new Float32Array(w);
  const rows = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) p[x] += s[y * w + x];
  for (let x = 0; x < w; x++) p[x] /= rows;
  return p;
}
function rowProfile(s: Float32Array, w: number, h: number, x0: number, x1: number): Float32Array {
  const p = new Float32Array(h);
  const cols = Math.max(1, x1 - x0);
  for (let y = 0; y < h; y++) { let a = 0; for (let x = x0; x < x1; x++) a += s[y * w + x]; p[y] = a / cols; }
  return p;
}

/** 最小二乘直线 y = a + b*x，剔除离群点后重拟合 */
function fitLine(pts: [number, number][]): { a: number; b: number } | null {
  let use = pts;
  for (let it = 0; it < 3; it++) {
    if (use.length < 3) return null;
    const n = use.length;
    const mx = use.reduce((s, p) => s + p[0], 0) / n, my = use.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, sxy = 0;
    for (const [x, y] of use) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
    if (sxx === 0) return null;
    const b = sxy / sxx, a = my - b * mx;
    const res = use.map(([x, y]) => Math.abs(y - (a + b * x)));
    const med = [...res].sort((p, q) => p - q)[Math.floor(res.length / 2)];
    const keep = use.filter((_, i) => res[i] <= Math.max(1.5, med * 2.5));
    if (keep.length === use.length) return { a, b };
    use = keep;
  }
  return null;
}

/** 估计倾斜角（度，画布顺时针为正）：取四条边各自拟合出的角度的中位数，限制在 ±3° */
export function detectAngle(img: Img, invert: boolean): number {
  const { width: w, height: h } = img;
  const s = signal(img, invert);
  const angs: number[] = [];
  const bands = 7, bh = Math.max(3, Math.round(h * 0.06)), bw = Math.max(3, Math.round(w * 0.06));
  const left: [number, number][] = [], right: [number, number][] = [], top: [number, number][] = [], bottom: [number, number][] = [];
  for (let i = 0; i < bands; i++) {
    const cy = Math.round(h * (0.2 + (0.6 * i) / (bands - 1)));
    const p = colProfile(s, w, h, Math.max(0, cy - bh / 2 | 0), Math.min(h, cy + bh / 2 | 0 || 1));
    const l = edgeIndex(p, false), r = edgeIndex(p, true);
    if (l !== null) left.push([cy, l]);
    if (r !== null) right.push([cy, r]);
    const cx = Math.round(w * (0.2 + (0.6 * i) / (bands - 1)));
    const q = rowProfile(s, w, h, Math.max(0, cx - bw / 2 | 0), Math.min(w, cx + bw / 2 | 0 || 1));
    const t = edgeIndex(q, false), b = edgeIndex(q, true);
    if (t !== null) top.push([cx, t]);
    if (b !== null) bottom.push([cx, b]);
  }
  for (const side of [left, right]) { const f = fitLine(side); if (f) angs.push((Math.atan(f.b) * 180) / Math.PI); }
  for (const side of [top, bottom]) { const f = fitLine(side); if (f) angs.push((-Math.atan(f.b) * 180) / Math.PI); }
  if (!angs.length) return 0;
  const a = [...angs].sort((x, y) => x - y)[Math.floor(angs.length / 2)];
  return Math.max(-3, Math.min(3, Math.round(a * 10) / 10));
}

/** 在已纠偏的图上找画面矩形。没找到明显边框就返回 null（不裁） */
export function detectCrop(img: Img, invert: boolean, margin = 0.004): Crop | null {
  const { width: w, height: h } = img;
  const s = signal(img, invert);
  const cp = colProfile(s, w, h, Math.round(h * 0.15), Math.round(h * 0.85));
  const rp = rowProfile(s, w, h, Math.round(w * 0.15), Math.round(w * 0.85));
  const l = edgeIndex(cp, false), r = edgeIndex(cp, true), t = edgeIndex(rp, false), b = edgeIndex(rp, true);
  if (l === null && r === null && t === null && b === null) return null;
  const mx = Math.max(2, Math.round(w * margin)), my = Math.max(2, Math.round(h * margin));
  const x0 = l === null ? 0 : Math.min(w - 2, l + mx), x1 = r === null ? w : Math.max(x0 + 1, r - mx);
  const y0 = t === null ? 0 : Math.min(h - 2, t + my), y1 = b === null ? h : Math.max(y0 + 1, b - my);
  const c = { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
  if (c.w > 0.985 && c.h > 0.985) return null;
  if (c.w < 0.3 || c.h < 0.3) return null; // 太小，多半是误判
  return c;
}

/** 在 crop 内按宽高比（宽/高，像素意义上）居中收缩 */
export function fitAspect(c: Crop, aspect: number, imgW: number, imgH: number): Crop {
  const cw = c.w * imgW, ch = c.h * imgH;
  let nw = cw, nh = ch;
  if (cw / ch > aspect) nw = ch * aspect; else nh = cw / aspect;
  return { x: c.x + (cw - nw) / 2 / imgW, y: c.y + (ch - nh) / 2 / imgH, w: nw / imgW, h: nh / imgH };
}
