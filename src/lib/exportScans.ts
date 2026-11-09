import { db, type Frame, type Roll } from '../db/schema';
import { injectExif, makeZip, type ExifInfo } from './exif';
import { FORMAT_LABEL } from './hooks';

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

/** 导出一卷的扫描件：每张 JPEG 写入 EXIF（相机/片种/ISO/日期/快门光圈焦距/备注），附 metadata.csv，打成 ZIP */
export async function exportRollScans(
  roll: Roll,
  frames: Frame[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; name: string }> {
  const [stock, camera, visit] = await Promise.all([
    db.stocks.get(roll.stockId),
    roll.cameraId ? db.cameras.get(roll.cameraId) : undefined,
    roll.labVisitId ? db.labVisits.get(roll.labVisitId) : undefined,
  ]);
  const lab = visit ? await db.labs.get(visit.labId) : undefined;
  const stockName = stock ? `${stock.brand} ${stock.name}` : '';
  const date = roll.unloadedAt ?? roll.loadedAt;
  const iso = roll.shotIso ?? stock?.iso;
  const rollTag = safe([stockName, date ?? ''].filter(Boolean).join('_')) || 'roll';
  const files: { name: string; data: Uint8Array }[] = [];
  const rows = [['文件名', '张号', '片种', '画幅', 'ISO', '相机', '拍摄日期', '冲扫店', '快门', '光圈', '焦距', '地点', '备注'].join(',')];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const raw = await jpegBytes(f.photoId);
    if (raw) {
      const desc = [stockName, FORMAT_LABEL[roll.format], `第 ${f.order + 1} 张`, f.place, f.note].filter(Boolean).join(' · ');
      const info: ExifInfo = { model: camera?.name, description: desc, iso, date, shutter: f.shutter, aperture: f.aperture, focal: f.focal };
      const name = `${rollTag}_${String(f.order + 1).padStart(3, '0')}.jpg`;
      files.push({ name, data: injectExif(raw, info) });
      rows.push([name, f.order + 1, stockName, FORMAT_LABEL[roll.format], iso, camera?.name, date, lab?.name, f.shutter, f.aperture, f.focal, f.place, f.note].map(csvCell).join(','));
    }
    onProgress?.(i + 1, frames.length);
  }
  files.push({ name: 'metadata.csv', data: new TextEncoder().encode('﻿' + rows.join('\r\n')) });
  return { blob: makeZip(files), name: `${rollTag}.zip` };
}
