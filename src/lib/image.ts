import { db, uid } from '../db/schema';

/** 压缩成最长边 ~600px 的 JPEG，缩略图足够，体积小，备份也轻 */
export async function compressImage(file: File, maxSide = 600): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('图片压缩失败'))), 'image/jpeg', 0.82),
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
