import { db, type Frame, type FilmFormat } from '../db/schema';

/** 接触印相式索引图：片边齿孔、片号、胶片名；可出 A4 分页或一张长图，PNG / PDF。 */
export type SheetLayout = 'a4' | 'long';
export type BandStyle = 'print' | 'base';
export type Paper = 'white' | 'dark';

export interface SheetOpts { layout: SheetLayout; band: BandStyle; paper: Paper; width?: number }
export interface SheetMeta {
  title: string; // 胶卷名
  lines: string[]; // 页眉下面的信息行
  format: FilmFormat;
  edgeText: string; // 印在片边的文字（用胶卷自己的名字，不仿造厂商字样）
  bw: boolean;
}

const PAPER = { white: { bg: '#f6f2ea', ink: '#1b1713', sub: '#6d6558', hole: '#f6f2ea' }, dark: { bg: '#14110f', ink: '#f3eadc', sub: '#a39685', hole: '#14110f' } };

function plan(format: FilmFormat, medianAspect: number): { cols: number; aspect: number; sprockets: boolean } {
  if (format === '135') return { cols: 6, aspect: 1.5, sprockets: true };
  if (format === '4x5') return { cols: 2, aspect: 1.25, sprockets: false };
  if (format === '110') return { cols: 6, aspect: 1.33, sprockets: false };
  // 120：按画幅比例就近取 6×6 / 6×7 / 6×4.5 / 6×9
  const a = Math.max(medianAspect, 1 / medianAspect);
  const opts: [number, number][] = [[1, 3], [7 / 6, 3], [4 / 3, 4], [1.5, 2]];
  const best = opts.reduce((p, c) => (Math.abs(c[0] - a) < Math.abs(p[0] - a) ? c : p));
  return { cols: best[1], aspect: best[0], sprockets: false };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 1.5; };

export async function renderSheets(frames: Frame[], meta: SheetMeta, o: SheetOpts): Promise<HTMLCanvasElement[]> {
  const W = o.width ?? (o.layout === 'a4' ? 2480 : 2000);
  const PH = Math.round(W * 1.4142); // A4 比例
  const P = PAPER[o.paper];
  const m = Math.round(W * 0.06);
  const { cols, aspect, sprockets } = plan(meta.format, median(frames.map((f) => (f.width && f.height ? f.width / f.height : 1.5))));
  const stripW = W - 2 * m;
  const padX = W * 0.012, gapX = W * (sprockets ? 0.008 : 0.012);
  const cellW = (stripW - 2 * padX - (cols - 1) * gapX) / cols;
  const cellH = cellW / aspect;
  const holeRow = sprockets ? cellW * 0.17 : 0, textRow = cellW * 0.11, padY = cellW * 0.05;
  const bandH = sprockets ? holeRow * 2 + textRow * 2 + cellH + padY : padY * 2 + cellH + textRow;
  const vgap = W * 0.018;
  const headerH = W * 0.13, footerH = W * 0.04;
  const rowsAll = Math.ceil(frames.length / cols);
  const perPage = o.layout === 'a4' ? Math.max(1, Math.floor((PH - 2 * m - headerH - footerH + vgap) / (bandH + vgap))) : rowsAll;
  const pages = Math.max(1, Math.ceil(rowsAll / perPage));

  const bandFill = o.band === 'print' ? '#0c0b0a' : meta.bw ? '#5c5851' : '#bf6a1c';
  const textCol = o.band === 'print' ? '#e8e1d3' : meta.bw ? '#d4cec3' : '#ffd8a0';
  const holeCol = P.hole;
  const out: HTMLCanvasElement[] = [];
  const cache = new Map<string, ImageBitmap | null>();
  const bmpOf = async (id: string) => {
    if (cache.has(id)) return cache.get(id)!;
    const p = await db.photos.get(id);
    const b = p ? await createImageBitmap(p.blob, { imageOrientation: 'from-image' }) : null;
    cache.set(id, b);
    return b;
  };

  for (let pg = 0; pg < pages; pg++) {
    const rows = o.layout === 'a4' ? Math.min(perPage, rowsAll - pg * perPage) : rowsAll;
    const H = o.layout === 'a4' ? PH : Math.round(2 * m + headerH + rows * bandH + (rows - 1) * vgap + footerH);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    // 页眉
    if (pg === 0) {
      g.fillStyle = P.ink; g.font = `700 ${W * 0.036}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`; g.fillText(meta.title, m, m + W * 0.04);
      g.fillStyle = P.sub; g.font = `${W * 0.017}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      meta.lines.slice(0, 3).forEach((t, i) => g.fillText(t, m, m + W * 0.04 + W * 0.03 * (i + 1)));
    } else {
      g.fillStyle = P.sub; g.font = `${W * 0.016}px system-ui, "PingFang SC", sans-serif`; g.fillText(`${meta.title} · ${pg + 1}/${pages}`, m, m + W * 0.02);
    }
    const top = m + (pg === 0 ? headerH : W * 0.04);
    for (let r = 0; r < rows; r++) {
      const y = top + r * (bandH + vgap);
      g.fillStyle = bandFill; g.beginPath(); g.roundRect(m, y, stripW, bandH, W * 0.004); g.fill();
      const x0 = m + padX;
      const fy = y + (sprockets ? holeRow + textRow : padY);
      // 齿孔
      if (sprockets) {
        const pitch = (cellW + gapX) / 8, hw = pitch * 0.56, hh = holeRow * 0.6;
        g.fillStyle = holeCol;
        for (let x = x0 + pitch * 0.25; x < m + stripW - padX; x += pitch) {
          g.beginPath(); g.roundRect(x, y + (holeRow - hh) / 2, hw, hh, hh * 0.22); g.fill();
          g.beginPath(); g.roundRect(x, y + bandH - holeRow + (holeRow - hh) / 2, hw, hh, hh * 0.22); g.fill();
        }
      }
      for (let k = 0; k < cols; k++) {
        const idx = (pg * perPage + r) * cols + k;
        const f = frames[idx];
        const x = x0 + k * (cellW + gapX);
        if (!f) continue;
        // 画面
        g.fillStyle = '#000'; g.fillRect(x, fy, cellW, cellH);
        const b = await bmpOf(f.thumbId);
        if (b) {
          const fa = b.width / b.height, ca = cellW / cellH;
          const cover = Math.abs(fa / ca - 1) < 0.15;
          const s = cover ? Math.max(cellW / b.width, cellH / b.height) : Math.min(cellW / b.width, cellH / b.height);
          g.save(); g.beginPath(); g.rect(x, fy, cellW, cellH); g.clip();
          g.drawImage(b, x + (cellW - b.width * s) / 2, fy + (cellH - b.height * s) / 2, b.width * s, b.height * s);
          g.restore();
        }
        // 片号 / 片边文字
        g.fillStyle = textCol; g.font = `600 ${textRow * 0.78}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
        const n = f.order + 1;
        if (sprockets) {
          const by = y + bandH - holeRow - textRow * 0.22;
          g.textAlign = 'left'; g.fillText(`▸${n}`, x, by);
          g.textAlign = 'right'; g.fillText(`${n}A`, x + cellW, by);
          if (k % 2 === 0 && meta.edgeText) { g.textAlign = 'left'; g.font = `600 ${textRow * 0.7}px system-ui, sans-serif`; g.fillText(meta.edgeText.toUpperCase(), x + cellW * 0.08, y + holeRow + textRow * 0.78); }
        } else {
          g.textAlign = 'center'; g.fillText(String(n), x + cellW / 2, fy + cellH + textRow * 0.82);
        }
        g.textAlign = 'left';
      }
    }
    // 页脚
    g.fillStyle = P.sub; g.font = `${W * 0.012}px system-ui, sans-serif`;
    g.textAlign = 'right'; g.fillText(`胶卷柜 Film Shelf · ${frames.length} frames`, W - m, H - m * 0.5); g.textAlign = 'left';
    out.push(c);
  }
  cache.forEach((b) => b?.close?.());
  return out;
}

const toJpeg = (c: HTMLCanvasElement, q = 0.92): Promise<Uint8Array> =>
  new Promise((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('生成图片失败'))), 'image/jpeg', q));

/** 极简 PDF：每页一张满版 JPEG（不依赖第三方库）。A4 页用 A4 尺寸，长图按宽度 A4 等比。 */
export async function canvasesToPdf(canvases: HTMLCanvasElement[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); pos += u.length; };
  const obj = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n`);
    if (typeof body === 'string') push(body); else body.forEach((p) => push(p));
    push('\nendobj\n');
  };
  const jpgs = await Promise.all(canvases.map((c) => toJpeg(c)));
  const n = canvases.length;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, `<</Type/Pages/Kids[${canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}]/Count ${n}>>`);
  canvases.forEach((c, i) => {
    const pw = 595.28, ph = pw * (c.height / c.width);
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
    obj(pid, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}]/Resources<</XObject<</Im0 ${iid} 0 R>>>>/Contents ${cid} 0 R>>`);
    const content = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(cid, `<</Length ${content.length}>>\nstream\n${content}\nendstream`);
    obj(iid, [enc.encode(`<</Type/XObject/Subtype/Image/Width ${c.width}/Height ${c.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpgs[i].length}>>\nstream\n`), jpgs[i], enc.encode('\nendstream')]);
  });
  const total = 3 + n * 3;
  const xref = pos;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

export const canvasToPngBlob = (c: HTMLCanvasElement): Promise<Blob> =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('生成图片失败'))), 'image/png'));

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
