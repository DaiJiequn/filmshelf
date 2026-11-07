import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { Chips, Empty } from '../components/ui';
import { addFrames, deleteFrame, updateFrame } from '../db/actions';
import { db, type Frame } from '../db/schema';
import { usePhotoUrl, useSettings } from '../lib/hooks';
import { SPRING, useMotionLevel } from '../motion/tokens';

export function Thumb({ photoId, alt = '' }: { photoId?: string; alt?: string }) {
  const url = usePhotoUrl(photoId);
  return url ? <img src={url} alt={alt} loading="lazy" draggable={false} /> : <span className="thumb-ph" />;
}

type View = 'grid' | 'index';

export default function Scans() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [settings] = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('grid');
  const [open, setOpen] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const data = useLiveQuery(async () => {
    const roll = await db.rolls.get(id);
    const stock = roll ? await db.stocks.get(roll.stockId) : undefined;
    const frames = await db.frames.where('rollId').equals(id).sortBy('order');
    return { roll, stock, frames };
  }, [id]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setProgress({ done: 0, total: files.length });
    const res = await addFrames(id, [...files], settings.scanQuality, (done, total) => setProgress({ done, total }));
    setProgress(null);
    if (res.failed.length) {
      toast.show(`导入 ${res.added} 张，${res.failed.length} 张失败（${res.failed.slice(0, 2).join('、')}${res.failed.length > 2 ? '…' : ''}）。TIFF 等浏览器不能解码的格式请先转成 JPG。`, { tone: 'error' });
    } else {
      toast.show(`已导入 ${res.added} 张扫描件`);
    }
  }, [id, settings.scanQuality, toast]);

  if (!data) return <div className="page" />;
  const { roll, stock, frames } = data;
  if (!roll) return <div className="page"><PageHeader title="找不到这卷" back /><Empty title="这卷胶卷不存在" /></div>;

  const exportIndex = async () => {
    try {
      await downloadIndexSheet(frames, `${stock?.brand ?? ''} ${stock?.name ?? ''}`.trim());
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="扫描件"
        sub={`${stock ? `${stock.brand} ${stock.name}` : ''} · ${frames.length} 张`}
        back
        right={<button className="btn small primary" disabled={!!progress} onClick={() => fileRef.current?.click()}>＋ 导入</button>}
      />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

      {progress && (
        <div className="card progress-import" role="status">
          <span>正在导入 {Math.min(progress.done + 1, progress.total)} / {progress.total}…</span>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
        </div>
      )}

      {frames.length === 0 ? (
        <Empty
          title="还没有扫描件"
          text="把这卷扫好的照片导进来，会按文件名顺序排成一卷。图片压缩后存在本机，不会上传。"
          action={<button className="btn primary" onClick={() => fileRef.current?.click()}>选择照片</button>}
        />
      ) : (
        <>
          <div className="row-btns spread">
            <Chips<View> value={view} onChange={setView} options={[{ value: 'grid', label: '网格' }, { value: 'index', label: '底片条' }]} />
            {view === 'index' && <button className="btn small ghost" onClick={exportIndex}>导出索引图</button>}
          </div>
          {view === 'grid' ? (
            <div className="scan-grid">
              {frames.map((f, i) => (
                <button key={f.id} className="scan-cell" onClick={() => setOpen(i)} aria-label={`第 ${f.order + 1} 张`}>
                  <Thumb photoId={f.thumbId} />
                  <span className="scan-no mono">{f.order + 1}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="strips">
              {chunk(frames, 6).map((row, ri) => (
                <div key={ri} className="strip">
                  {row.map((f) => (
                    <button key={f.id} className="strip-cell" onClick={() => setOpen(frames.indexOf(f))} aria-label={`第 ${f.order + 1} 张`}>
                      <Thumb photoId={f.thumbId} />
                      <span className="strip-no mono">{f.order + 1}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Viewer frames={frames} index={open} setIndex={setOpen} />
    </div>
  );
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

const FIELDS: { key: 'shutter' | 'aperture' | 'focal' | 'place' | 'note'; label: string; ph: string; wide?: boolean }[] = [
  { key: 'shutter', label: '快门', ph: '1/125' },
  { key: 'aperture', label: '光圈', ph: 'f/2.8' },
  { key: 'focal', label: '焦距', ph: '50mm' },
  { key: 'place', label: '地点', ph: '京都 · 清水寺' },
  { key: 'note', label: '备注', ph: '这一张的想法', wide: true },
];

function Viewer({ frames, index, setIndex }: { frames: Frame[]; index: number | null; setIndex: (i: number | null) => void }) {
  const level = useMotionLevel();
  const frame = index !== null ? frames[index] : undefined;
  const url = usePhotoUrl(frame?.photoId);
  const [confirmDel, setConfirmDel] = useState(false);
  const toast = useToast();

  const go = useCallback((d: number) => {
    if (index === null) return;
    const n = index + d;
    if (n >= 0 && n < frames.length) setIndex(n);
  }, [index, frames.length, setIndex]);

  useEffect(() => { setConfirmDel(false); }, [index]);
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') setIndex(null);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [index, go, setIndex]);

  return createPortal(
    <AnimatePresence>
      {frame && (
        <motion.div className="viewer" role="dialog" aria-modal="true" aria-label="查看扫描件" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: level === 'off' ? 0 : 0.18 }}>
          <div className="viewer-top">
            <button className="icon-btn" onClick={() => setIndex(null)} aria-label="关闭">✕</button>
            <span className="mono">{frame.order + 1} / {frames.length}</span>
            <span style={{ width: 40 }} />
          </div>
          <div className="viewer-stage">
            <motion.div
              key={frame.id}
              className="viewer-img"
              drag={level === 'off' ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.5}
              onDragEnd={(_, info) => { if (info.offset.x < -80) go(1); else if (info.offset.x > 80) go(-1); }}
              initial={level === 'full' ? { opacity: 0, scale: 0.98 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING.soft}
            >
              {url ? <img src={url} alt={`第 ${frame.order + 1} 张`} draggable={false} /> : <span className="thumb-ph" />}
            </motion.div>
            <button className="viewer-nav left" onClick={() => go(-1)} disabled={index === 0} aria-label="上一张">‹</button>
            <button className="viewer-nav right" onClick={() => go(1)} disabled={index === frames.length - 1} aria-label="下一张">›</button>
          </div>
          <div className="viewer-info" key={frame.id}>
            <div className="viewer-fields">
              {FIELDS.map((f) => (
                <label key={f.key} className={`vfield ${f.wide ? 'wide' : ''}`}>
                  <span>{f.label}</span>
                  <input
                    id={`frame-${f.key}`}
                    defaultValue={frame[f.key] ?? ''}
                    placeholder={f.ph}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (frame[f.key] ?? '')) updateFrame(frame.id, { [f.key]: v || undefined }); }}
                  />
                </label>
              ))}
            </div>
            <div className="row-btns">
              {url && (
                <a className="btn small ghost" href={url} download={`frame-${frame.order + 1}.jpg`}>保存图片</a>
              )}
              {confirmDel ? (
                <button className="btn small danger" onClick={async () => {
                  const i = index!;
                  await deleteFrame(frame.id);
                  toast.show('已删除这张扫描件');
                  setIndex(frames.length <= 1 ? null : Math.min(i, frames.length - 2));
                }}>确认删除</button>
              ) : (
                <button className="btn small ghost danger-text" onClick={() => setConfirmDel(true)}>删除</button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 把缩略图拼成一张「底片条索引图」PNG 并下载 */
async function downloadIndexSheet(frames: Frame[], title: string): Promise<void> {
  const cols = 6, cell = 220, pad = 18, perf = 16, gap = 8, head = 70;
  const rows = Math.ceil(frames.length / cols);
  const stripH = cell * 2 / 3 + perf * 2 + 8;
  const W = pad * 2 + cols * cell + (cols - 1) * gap;
  const H = head + rows * (stripH + 14) + pad;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#14110f'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f3eadc'; g.font = '600 28px system-ui, sans-serif'; g.fillText(title || '胶卷索引', pad, 44);
  g.fillStyle = '#a39685'; g.font = '16px ui-monospace, monospace'; g.fillText(`${frames.length} frames`, W - pad - 110, 44);
  for (let r = 0; r < rows; r++) {
    const y = head + r * (stripH + 14);
    g.fillStyle = '#080706'; g.fillRect(pad - 6, y, W - pad * 2 + 12, stripH);
    g.fillStyle = '#3a322c';
    for (let x = pad; x < W - pad; x += 22) {
      g.fillRect(x, y + 4, 10, 8); g.fillRect(x, y + stripH - 12, 10, 8);
    }
    for (let k = 0; k < cols; k++) {
      const f = frames[r * cols + k];
      if (!f) break;
      const x = pad + k * (cell + gap);
      const p = await db.photos.get(f.thumbId);
      if (p) {
        const bmp = await createImageBitmap(p.blob);
        const w = cell, h = cell * 2 / 3;
        const s = Math.max(w / bmp.width, h / bmp.height);
        g.save(); g.beginPath(); g.rect(x, y + perf + 4, w, h); g.clip();
        g.drawImage(bmp, x + (w - bmp.width * s) / 2, y + perf + 4 + (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
        g.restore(); bmp.close?.();
      }
      g.fillStyle = '#f0a93a'; g.font = '12px ui-monospace, monospace'; g.fillText(String(f.order + 1), x + 4, y + stripH - 14);
    }
  }
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('生成索引图失败'))), 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `index-${(title || 'film').replace(/\s+/g, '-')}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
