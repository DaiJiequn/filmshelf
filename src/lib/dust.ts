import { db, uid, type Frame } from '../db/schema';
import { compressImage } from './image';
import type { DustMsg } from './dust.worker';

export type DustPolarity = 'auto' | 'white' | 'dark';
export interface DustOpts { polarity: DustPolarity; sensitivity: number }

const MAX_SIDE = 6000;

/** 对当前显示的图自动除尘，结果替换查看图，原图保留（可还原）。返回清除的处数。 */
export function dustFrame(frame: Frame, opts: DustOpts, onProgress: (frac: number, text: string) => void): { promise: Promise<number>; cancel: () => void } {
  let worker: Worker | null = null;
  const promise = (async () => {
    const cur = await db.frames.get(frame.id);
    if (!cur) throw new Error('这张已被删除');
    const src = await db.photos.get(cur.photoId);
    if (!src) throw new Error('找不到图片');
    const bmp = await createImageBitmap(src.blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const id = ctx.getImageData(0, 0, w, h);
    const rgb = new Uint16Array(w * h * 3);
    for (let i = 0, j = 0; i < id.data.length; i += 4, j += 3) {
      rgb[j] = id.data[i] * 257; rgb[j + 1] = id.data[i + 1] * 257; rgb[j + 2] = id.data[i + 2] * 257;
    }
    worker = new Worker(new URL('./dust.worker.ts', import.meta.url), { type: 'module' });
    const w2 = worker;
    const res = await new Promise<{ rgb: Uint16Array; healed: number }>((ok, bad) => {
      w2.onmessage = (e: MessageEvent<DustMsg>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.frac, m.text);
        else if (m.type === 'done') ok({ rgb: m.rgb, healed: m.healed });
        else bad(new Error(m.message));
      };
      w2.onerror = (e) => bad(new Error(e.message || '除尘线程出错'));
      w2.postMessage({ w, h, rgb, polarity: opts.polarity, sensitivity: opts.sensitivity }, [rgb.buffer]);
    });
    w2.terminate(); worker = null;
    if (res.healed <= 0) return 0;
    for (let i = 0, j = 0; i < id.data.length; i += 4, j += 3) {
      id.data[i] = (res.rgb[j] + 128) / 257; id.data[i + 1] = (res.rgb[j + 1] + 128) / 257; id.data[i + 2] = (res.rgb[j + 2] + 128) / 257;
    }
    ctx.putImageData(id, 0, 0);
    const blob: Blob = await new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('导出失败'))), 'image/jpeg', 0.93));
    const thumb = await compressImage(blob, 480, 0.8);
    const photoId = uid(), thumbId = uid();
    const latest = await db.frames.get(frame.id);
    if (!latest) throw new Error('这张已被删除');
    await db.transaction('rw', db.photos, db.frames, async () => {
      await db.photos.bulkAdd([
        { id: photoId, blob, width: w, height: h },
        { id: thumbId, blob: thumb.blob, width: thumb.width, height: thumb.height },
      ]);
      // 没有原图记录时，把除尘前的图当作原图保留；已有则只替换上一次的结果
      const orig = latest.origPhotoId ?? latest.photoId;
      const stale = [latest.thumbId, ...(latest.origPhotoId ? [latest.photoId] : [])];
      await db.photos.bulkDelete(stale);
      await db.frames.update(frame.id, {
        photoId, thumbId, width: w, height: h, origPhotoId: orig,
        dust: { healed: (latest.dust?.healed ?? 0) + res.healed, at: new Date().toISOString() },
      });
    });
    return res.healed;
  })();
  return { promise: promise.finally(() => { worker?.terminate(); }), cancel: () => { worker?.terminate(); worker = null; } };
}
