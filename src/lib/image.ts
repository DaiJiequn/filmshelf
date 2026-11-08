import { isRawFile, rawToJpeg } from './raw';
import { db, uid } from '../db/schema';

/** 压缩成最长边 ~600px 的 JPEG，缩略图足够，体积小，备份也轻 */
export async function compressImage(file: Blob, maxSide = 600, quality = 0.82): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('图片压缩失败'))), 'image/jpeg', quality),
  );
  return { blob, width: w, height: h };
}

export async function savePhoto(file: File, replaceId?: string): Promise<string> {
  const { blob, width, height } = await compressImage(file);
  const id = uid();
  await db.photos.add({ id, blob, width, height });
  if (replaceId) await db.photos.delete(replaceId);
  return id;
}

/** 品牌色：用于罐身与图鉴 */
export function brandColors(brand: string): { body: string; label: string; ink: string } {
  const b = brand.toLowerCase();
  if (b.includes('kodak')) return { body: '#e8a317', label: '#c8261e', ink: '#fff6df' };
  if (b.includes('fuji')) return { body: '#2f8f5b', label: '#f4f1e8', ink: '#0f3d24' };
  if (b.includes('ilford') || b.includes('kentmere')) return { body: '#2a2a2a', label: '#f4f1e8', ink: '#1a1a1a' };
  if (b.includes('cine')) return { body: '#8a3b2f', label: '#f2d7a8', ink: '#3a1710' };
  if (b.includes('lomo')) return { body: '#c9285b', label: '#fbe9ef', ink: '#5b1030' };
  if (b.includes('agfa')) return { body: '#d9531e', label: '#f6efe0', ink: '#4a1e0a' };
  if (b.includes('foma')) return { body: '#2f5d8a', label: '#eef3f7', ink: '#14304a' };
  if (b.includes('rollei')) return { body: '#1d1d1d', label: '#e4b422', ink: '#1d1d1d' };
  if (b.includes('adox')) return { body: '#b32121', label: '#f4f1e8', ink: '#4a0b0b' };
  let h = 0;
  for (const c of brand) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { body: `hsl(${h} 45% 42%)`, label: '#f4f1e8', ink: `hsl(${h} 45% 16%)` };
}

export const TYPE_LABEL = { 'color-neg': '彩色负片', bw: '黑白', slide: '反转片', cine: '电影卷' } as const;


export type ScanQuality = 'standard' | 'high' | 'original';
export const SCAN_QUALITY_LABEL: Record<ScanQuality, string> = {
  standard: '标准（最长边 2400px）',
  high: '高（最长边 4000px）',
  original: '原图（不压缩，占空间大）',
};

const isTiff = (f: File) => /\.tiff?$/i.test(f.name) || f.type === 'image/tiff';

/** 按 EXIF Orientation（1–8）把画布转正；1 或未知值原样返回 */
export function orientCanvas(src: HTMLCanvasElement, o: number): HTMLCanvasElement {
  if (!o || o === 1 || o > 8) return src;
  const swap = o >= 5;
  const c = document.createElement('canvas');
  c.width = swap ? src.height : src.width;
  c.height = swap ? src.width : src.height;
  const g = c.getContext('2d')!;
  const w = src.width, h = src.height;
  // 各取向对应的变换矩阵（EXIF 标准）
  const m: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w],
  };
  g.setTransform(...m[o]);
  g.drawImage(src, 0, 0);
  return c;
}

/** 浏览器不能直接解码 TIFF（Filmer 等扫描软件常导出）：用 UTIF（MIT）解码后转成高质量 JPEG */
export async function tiffToJpeg(file: File): Promise<Blob> {
  const UTIF = (await import('utif')).default;
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('无法读取 TIFF');
  UTIF.decodeImage(buf, ifds[0]);
  const { width, height } = ifds[0] as { width: number; height: number };
  const rgba = UTIF.toRGBA8(ifds[0]);
  const src = document.createElement('canvas');
  src.width = width; src.height = height;
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
  const c = orientCanvas(src, ((ifds[0] as unknown as { t274?: number[] }).t274 ?? [1])[0]);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('TIFF 转换失败'))), 'image/jpeg', 0.95));
}

/** 导入一张扫描件：生成查看用大图 + 缩略图，返回两个 Photo 的 id */
export async function importScan(input: File, quality: ScanQuality): Promise<{ photoId: string; thumbId: string; width: number; height: number }> {
  let file: Blob = input;
  if (isRawFile(input)) file = await rawToJpeg(input);
  else if (isTiff(input)) file = await tiffToJpeg(input);
  const thumb = await compressImage(file, 480, 0.8);
  let full: { blob: Blob; width: number; height: number };
  if (quality === 'original') {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    full = { blob: file, width: bmp.width, height: bmp.height };
    bmp.close?.();
  } else {
    full = await compressImage(file, quality === 'high' ? 4000 : 2400, 0.88);
  }
  const photoId = uid();
  const thumbId = uid();
  await db.photos.bulkAdd([
    { id: photoId, blob: full.blob, width: full.width, height: full.height },
    { id: thumbId, blob: thumb.blob, width: thumb.width, height: thumb.height },
  ]);
  return { photoId, thumbId, width: full.width, height: full.height };
}
