import { db, type Frame, type Roll } from '../db/schema';
import { injectExif, makeZip, type ExifInfo } from './exif';
import { FORMAT_LABEL } from './hooks';
import { shotDate } from '../domain/digital';

const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');

async function jpegBytes(photoId: string): Promise<Uint8Array | null> {
  const p = await db.photos.get(photoId);
  if (!p) return null;
  let blob = p.blob;
  if (blob.type !== 'image/jpeg') {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close?.();
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.95));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function rollContext(roll: Roll) {
  const [stock, camera, visit] = await Promise.all([
    db.stocks.get(roll.stockId),
    roll.cameraId ? db.cameras.get(roll.cameraId) : undefined,
    roll.labVisitId ? db.labVisits.get(roll.labVisitId) : undefined,
  ]);
  const lab = visit ? await db.labs.get(visit.labId) : undefined;
  const stockName = stock ? `${stock.brand} ${stock.name}` : '';
  const date = shotDate(roll);
  const iso = roll.shotIso ?? stock?.iso;
  const rollTag = safe([stockName, date ?? ''].filter(Boolean).join('_')) || 'roll';
  return { camera, lab, stockName, date, iso, rollTag };
}
type Ctx = Awaited<ReturnType<typeof rollContext>>;

async function frameFile(roll: Roll, f: Frame, c: Ctx): Promise<{ name: string; data: Uint8Array } | null> {
  const raw = await jpegBytes(f.photoId);
  if (!raw) return null;
  const desc = [c.stockName, FORMAT_LABEL[roll.format], `第 ${f.order + 1} 张`, f.place, f.note].filter(Boolean).join(' · ');
  const info: ExifInfo = { model: c.camera?.name, description: desc, iso: c.iso, date: c.date, shutter: f.shutter, aperture: f.aperture, focal: f.focal, lens: f.lens };
  return { name: `${c.rollTag}_${String(f.order + 1).padStart(3, '0')}.jpg`, data: injectExif(raw, info) };
}

/** 导出单张：和整卷导出一样写入 EXIF、用同一套文件名 */
export async function exportFrame(f: Frame): Promise<{ blob: Blob; name: string } | null> {
  const roll = await db.rolls.get(f.rollId);
  if (!roll) return null;
  const file = await frameFile(roll, f, await rollContext(roll));
  return file ? { blob: new Blob([file.data as BlobPart], { type: 'image/jpeg' }), name: file.name } : null;
}

/** 导出一卷的扫描件：每张 JPEG 写入 EXIF（相机/片种/ISO/日期/快门光圈焦距/镜头/备注），附 metadata.csv，打成 ZIP */
export async function exportRollScans(
  roll: Roll,
  frames: Frame[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; name: string }> {
  const c = await rollContext(roll);
  const files: { name: string; data: Uint8Array }[] = [];
  const rows = [['文件名', '张号', '片种', '画幅', 'ISO', '相机', '拍摄日期', '冲扫店', '快门', '光圈', '焦距', '镜头', '地点', '备注'].join(',')];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const file = await frameFile(roll, f, c);
    if (file) {
      files.push(file);
      rows.push([file.name, f.order + 1, c.stockName, FORMAT_LABEL[roll.format], c.iso, c.camera?.name, c.date, c.lab?.name, f.shutter, f.aperture, f.focal, f.lens, f.place, f.note].map(csvCell).join(','));
    }
    onProgress?.(i + 1, frames.length);
  }
  files.push({ name: 'metadata.csv', data: new TextEncoder().encode('\ufeff' + rows.join('\r\n')) });
  return { blob: makeZip(files), name: `${c.rollTag}.zip` };
}
