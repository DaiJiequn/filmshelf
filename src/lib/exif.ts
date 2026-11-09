/**
 * 给 JPEG 写入 EXIF（胶片没有 EXIF，数字化后需要补上：相机、片种、ISO、拍摄日期、
 * 快门光圈焦距、备注），以及一个无依赖的 ZIP（仅存储）打包器。
 */

export interface ExifInfo {
  model?: string; // 相机
  description?: string; // 图像说明（片种 · 画幅 · 备注…，UTF-8）
  iso?: number;
  date?: string; // YYYY-MM-DD → DateTimeOriginal
  shutter?: string; // 1/125 或 2
  aperture?: string; // f/2.8
  focal?: string; // 50mm
  software?: string;
}

const enc = new TextEncoder();

/** "1/125" "0.5" "2" → [分子, 分母] */
export function parseRational(s?: string): [number, number] | null {
  if (!s) return null;
  const t = s.trim().replace(/["”s秒]$/i, '');
  const m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    return a > 0 && b > 0 ? [Math.round(a * 100), Math.round(b * 100)] : null;
  }
  const n = parseFloat(t.replace(/^f\/?/i, '').replace(/mm$/i, ''));
  if (!isFinite(n) || n <= 0) return null;
  return [Math.round(n * 100), 100];
}

type Entry = { tag: number; type: 2 | 3 | 4 | 5; count: number; data: Uint8Array };

const ascii = (tag: number, s: string): Entry => {
  const b = enc.encode(s);
  const d = new Uint8Array(b.length + 1);
  d.set(b);
  return { tag, type: 2, count: d.length, data: d };
};
const short = (tag: number, v: number): Entry => {
  const d = new Uint8Array(2);
  new DataView(d.buffer).setUint16(0, v, true);
  return { tag, type: 3, count: 1, data: d };
};
const long = (tag: number, v: number): Entry => {
  const d = new Uint8Array(4);
  new DataView(d.buffer).setUint32(0, v, true);
  return { tag, type: 4, count: 1, data: d };
};
const rational = (tag: number, [n, d]: [number, number]): Entry => {
  const b = new Uint8Array(8);
  const v = new DataView(b.buffer);
  v.setUint32(0, n, true); v.setUint32(4, d, true);
  return { tag, type: 5, count: 1, data: b };
};

/** 把一组 IFD 条目序列化；返回字节及其末尾追加的数据区（偏移相对 TIFF 头） */
function buildIfd(entries: Entry[], base: number): Uint8Array {
  entries.sort((a, b) => a.tag - b.tag);
  const headLen = 2 + entries.length * 12 + 4;
  let extra = 0;
  for (const e of entries) if (e.data.length > 4) extra += e.data.length + (e.data.length & 1);
  const out = new Uint8Array(headLen + extra);
  const v = new DataView(out.buffer);
  v.setUint16(0, entries.length, true);
  let ext = headLen;
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    v.setUint16(o, e.tag, true); v.setUint16(o + 2, e.type, true); v.setUint32(o + 4, e.count, true);
    if (e.data.length <= 4) out.set(e.data, o + 8);
    else { v.setUint32(o + 8, base + ext, true); out.set(e.data, ext); ext += e.data.length + (e.data.length & 1); }
  });
  v.setUint32(2 + entries.length * 12, 0, true);
  return out;
}

export function buildExifSegment(info: ExifInfo): Uint8Array {
  const ifd0: Entry[] = [];
  if (info.description) ifd0.push(ascii(0x010e, info.description));
  if (info.model) ifd0.push(ascii(0x0110, info.model));
  ifd0.push(ascii(0x0131, info.software ?? 'Film Shelf'));
  const exif: Entry[] = [];
  const sh = parseRational(info.shutter);
  if (sh) exif.push(rational(0x829a, sh));
  const fn = parseRational(info.aperture);
  if (fn) exif.push(rational(0x829d, fn));
  if (info.iso) exif.push(short(0x8827, Math.min(65535, Math.round(info.iso))));
  if (info.date && /^\d{4}-\d{2}-\d{2}/.test(info.date)) {
    const dt = info.date.slice(0, 10).replace(/-/g, ':') + ' 12:00:00';
    exif.push(ascii(0x9003, dt));
    exif.push(ascii(0x9004, dt));
  }
  const fl = parseRational(info.focal);
  if (fl) exif.push(rational(0x920a, fl));

  // IFD0 里要放一个指向 Exif IFD 的指针，先占位算出长度
  ifd0.push(long(0x8769, 0));
  const ifd0Len = buildIfd([...ifd0], 8).length;
  const exifOff = 8 + ifd0Len;
  const ifd0Final = ifd0.map((e) => (e.tag === 0x8769 ? long(0x8769, exifOff) : e));
  const ifd0Bytes = buildIfd(ifd0Final, 8);
  const exifBytes = buildIfd(exif, exifOff);

  const tiffLen = 8 + ifd0Bytes.length + exifBytes.length;
  const seg = new Uint8Array(4 + 6 + tiffLen);
  const v = new DataView(seg.buffer);
  seg[0] = 0xff; seg[1] = 0xe1;
  v.setUint16(2, seg.length - 2, false);
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  const t = 10;
  seg.set([0x49, 0x49, 0x2a, 0x00], t); // II*\0
  v.setUint32(t + 4, 8, true);
  seg.set(ifd0Bytes, t + 8);
  seg.set(exifBytes, t + 8 + ifd0Bytes.length);
  return seg;
}

/** 去掉原有的 Exif APP1，插入新的；不是 JPEG 时原样返回 */
export function injectExif(jpeg: Uint8Array, info: ExifInfo): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const seg = buildExifSegment(info);
  const kept: Uint8Array[] = [];
  let pos = 2;
  let insertAt = 0;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const marker = jpeg[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // 图像数据开始
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3];
    const isExif = marker === 0xe1 && jpeg[pos + 4] === 0x45 && jpeg[pos + 5] === 0x78 && jpeg[pos + 6] === 0x69 && jpeg[pos + 7] === 0x66;
    if (!isExif) kept.push(jpeg.subarray(pos, pos + 2 + len));
    if (marker === 0xe0 && !isExif) insertAt = kept.length;
    pos += 2 + len;
  }
  const rest = jpeg.subarray(pos);
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8]), ...kept.slice(0, insertAt), seg, ...kept.slice(insertAt), rest];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ─────────────── ZIP（仅存储，不压缩；JPEG 本来就压缩过了） ───────────────
let crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: { name: string; data: Uint8Array }[]): Blob {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    lh.set(name, 30);
    chunks.push(lh, f.data);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' });
}
