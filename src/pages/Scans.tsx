import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { Develop } from '../components/Develop';
import { IndexExport } from '../components/IndexExport';
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
  const [exporting, setExporting] = useState(false);
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
      toast.show(`导入 ${res.added} 张，${res.failed.length} 张失败（${res.failed.slice(0, 2).join('、')}${res.failed.length > 2 ? '…' : ''}）。可能是文件损坏或格式不支持。`, { tone: 'error' });
    } else {
      toast.show(`已导入 ${res.added} 张扫描件`);
    }
  }, [id, settings.scanQuality, toast]);

  if (!data) return <div className="page" />;
  const { roll, stock, frames } = data;
  if (!roll) return <div className="page"><PageHeader title="找不到这卷" back /><Empty title="这卷胶卷不存在" /></div>;

  return (
    <div className="page">
      <PageHeader
        title="扫描件"
        sub={`${stock ? `${stock.brand} ${stock.name}` : ''} · ${frames.length} 张`}
        back
        right={<button className="btn small primary" disabled={!!progress} onClick={() => fileRef.current?.click()}>＋ 导入</button>}
      />
      <input ref={fileRef} type="file" accept="image/*,.tif,.tiff,.3fr,.fff,.arw,.cr2,.cr3,.crw,.dng,.nef,.nrw,.orf,.pef,.raf,.rw2,.rwl,.srw,.iiq,.erf,.mrw,.kdc,.dcr,.raw,.x3f" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

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
            <button className="btn small ghost" onClick={() => setExporting(true)}>导出索引图</button>
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
      {exporting && <IndexExport rollId={roll.id} frames={frames} onClose={() => setExporting(false)} />}
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

interface ZoomView { s: number; x: number; y: number }
const MAX_ZOOM = 8;

/** 可缩放、可拖动的图片：双指捏合、双击放大、滚轮缩放；未放大时左右滑动换图、下滑关闭、单击切换界面 */
function ZoomPan({ src, thumb, alt, compareSrc, onPrev, onNext, onClose, onTap, onScale }: {
  src?: string; thumb?: string; alt: string; compareSrc?: string;
  onPrev: () => void; onNext: () => void; onClose: () => void; onTap: () => void; onScale: (s: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<ZoomView>({ s: 1, x: 0, y: 0 });
  const [anim, setAnim] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const v = useRef<ZoomView>({ s: 1, x: 0, y: 0 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; view: ZoomView; mid: { x: number; y: number } } | null>(null);
  const gesture = useRef({ moved: 0, gx: 0, gy: 0, t: 0, axis: '' as '' | 'x' | 'y' });
  const [split, setSplit] = useState(50);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const tapTimer = useRef<number | undefined>(undefined);

  const set = useCallback((n: ZoomView, animate = false) => {
    v.current = n;
    setAnim(animate);
    setViewState(n);
    onScale(n.s);
  }, [onScale]);

  const bounds = (s: number) => {
    const b = box.current, img = layer.current?.querySelector('img');
    if (!b || !img) return { mx: 0, my: 0 };
    return { mx: Math.max(0, (img.offsetWidth * s - b.clientWidth) / 2), my: Math.max(0, (img.offsetHeight * s - b.clientHeight) / 2) };
  };
  const clamp = (n: ZoomView): ZoomView => {
    const { mx, my } = bounds(n.s);
    return { s: n.s, x: Math.min(mx, Math.max(-mx, n.x)), y: Math.min(my, Math.max(-my, n.y)) };
  };
  const rel = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };
  /** 以屏幕点 p 为中心缩放到 s（保持该点下的图像内容不动） */
  const zoomAt = (p: { x: number; y: number }, s: number, base: ZoomView = v.current): ZoomView => {
    const ns = Math.min(MAX_ZOOM, Math.max(1, s));
    const k = ns / base.s;
    return { s: ns, x: p.x - (p.x - base.x) * k, y: p.y - (p.y - base.y) * k };
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      const n = zoomAt(rel(e.clientX, e.clientY), v.current.s * f);
      set(n.s <= 1.01 ? { s: 1, x: 0, y: 0 } : clamp(n));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const c = { x: 0, y: 0 };
      if (e.key === '+' || e.key === '=') set(clamp(zoomAt(c, v.current.s * 1.5)), true);
      if (e.key === '-') { const n = zoomAt(c, v.current.s / 1.5); set(n.s <= 1.01 ? { s: 1, x: 0, y: 0 } : clamp(n), true); }
      if (e.key === '0') set({ s: 1, x: 0, y: 0 }, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) gesture.current = { moved: 0, gx: 0, gy: 0, t: Date.now(), axis: '' };
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, view: v.current, mid: rel((a.x + b.x) / 2, (a.y + b.y) / 2) };
      gesture.current.moved = 99; // 不再算作点按
    }
    setAnim(false);
  };

  const move = (e: React.PointerEvent) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.current.size === 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      const base = pinch.current;
      const z = zoomAt(base.mid, base.view.s * (dist / base.dist), base.view);
      set({ s: z.s, x: z.x + (mid.x - base.mid.x), y: z.y + (mid.y - base.mid.y) });
      return;
    }
    const g = gesture.current;
    g.moved += Math.abs(dx) + Math.abs(dy);
    if (v.current.s > 1.01) {
      set({ s: v.current.s, x: v.current.x + dx, y: v.current.y + dy });
      return;
    }
    g.gx += dx; g.gy += dy;
    if (!g.axis && g.moved > 10) g.axis = Math.abs(g.gx) > Math.abs(g.gy) ? 'x' : 'y';
    if (g.axis === 'x') set({ s: 1, x: g.gx, y: 0 });
    if (g.axis === 'y') { set({ s: 1, x: 0, y: Math.max(0, g.gy) }); setDragY(Math.max(0, g.gy)); }
  };

  const up = (e: React.PointerEvent) => {
    const had = ptrs.current.delete(e.pointerId);
    if (!had) return;
    if (ptrs.current.size === 1) { pinch.current = null; return; }
    if (ptrs.current.size > 0) return;
    pinch.current = null;
    const g = gesture.current;
    const isTap = g.moved < 8 && Date.now() - g.t < 350;
    if (v.current.s > 1.01 && !isTap) { set(clamp(v.current), true); return; }
    if (v.current.s < 1.01) {
      if (g.axis === 'x' && Math.abs(g.gx) > 70) { set({ s: 1, x: 0, y: 0 }, true); g.gx < 0 ? onNext() : onPrev(); return; }
      if (g.axis === 'y' && g.gy > 110) { onClose(); return; }
    }
    setDragY(0);
    if (isTap) {
      const now = Date.now();
      const lt = lastTap.current;
      if (now - lt.t < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
        window.clearTimeout(tapTimer.current);
        lastTap.current = { t: 0, x: 0, y: 0 };
        set(v.current.s > 1.01 ? { s: 1, x: 0, y: 0 } : clamp(zoomAt(rel(e.clientX, e.clientY), 2.5)), true);
      } else {
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        window.clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(onTap, 260);
      }
      return;
    }
    set({ s: 1, x: 0, y: 0 }, true);
  };

  return (
    <div
      ref={box}
      className="zoombox"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ opacity: dragY ? Math.max(0.4, 1 - dragY / 400) : 1 }}
    >
      <div
        ref={layer}
        className="zoomlayer"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          transition: anim ? 'transform 220ms cubic-bezier(0.2, 0, 0, 1)' : 'none',
        }}
      >
        {thumb && !loaded && <img className="zimg under" src={thumb} alt="" draggable={false} />}
        {src && <img className={`zimg over ${loaded ? 'ok' : ''}`} src={src} alt={alt} draggable={false} onLoad={() => setLoaded(true)} />}
      </div>
      {compareSrc && (
        <>
          {/* 原图层：和上面同一个缩放/平移，只是被分割线裁掉右边 */}
          <div className="cmpclip" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
            <div className="zoomlayer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transition: anim ? 'transform 220ms cubic-bezier(0.2, 0, 0, 1)' : 'none' }}>
              <img className="zimg" src={compareSrc} alt="原图" draggable={false} />
            </div>
          </div>
          <span className="cmp-tag left">原图</span><span className="cmp-tag right">处理后</span>
          <div
            className="cmp-handle"
            role="slider"
            aria-label="对比分割线"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split)}
            tabIndex={0}
            style={{ left: `${split}%` }}
            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => {
              if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
              e.stopPropagation();
              const r = box.current!.getBoundingClientRect();
              setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
            }}
            onPointerUp={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); setSplit((s) => Math.max(0, s - 3)); } if (e.key === 'ArrowRight') { e.stopPropagation(); setSplit((s) => Math.min(100, s + 3)); } }}
          ><span className="cmp-knob">⇆</span></div>
        </>
      )}
    </div>
  );
}

function useWarm(photoId?: string) {
  const url = usePhotoUrl(photoId);
  useEffect(() => { if (url) { const i = new Image(); i.src = url; } }, [url]);
}

function Viewer({ frames, index, setIndex }: { frames: Frame[]; index: number | null; setIndex: (i: number | null) => void }) {
  const level = useMotionLevel();
  const frame = index !== null ? frames[index] : undefined;
  const url = usePhotoUrl(frame?.photoId);
  const thumbUrl = usePhotoUrl(frame?.thumbId);
  useWarm(index !== null ? frames[index + 1]?.photoId : undefined);
  useWarm(index !== null ? frames[index - 1]?.photoId : undefined);
  const [confirmDel, setConfirmDel] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [infoOpen, setInfoOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);
  const [scale, setScale] = useState(1);
  const [devOpen, setDevOpen] = useState(false);
  const [cmp, setCmp] = useState(false);
  const origUrl = usePhotoUrl(frame?.origPhotoId);
  const toast = useToast();
  const stripRef = useRef<HTMLDivElement>(null);

  const go = useCallback((d: number) => {
    if (index === null) return;
    const n = index + d;
    if (n >= 0 && n < frames.length) setIndex(n);
  }, [index, frames.length, setIndex]);

  useEffect(() => { setConfirmDel(false); setScale(1); setCmp(false); }, [index]);
  useEffect(() => { if (index === null) setChrome(true); }, [index]);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: level === 'full' ? 'smooth' : 'auto' });
  }, [index, level]);
  useEffect(() => {
    if (index === null || devOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') setIndex(null);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'i') setInfoOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [index, go, setIndex, devOpen]);

  const summary = frame ? [frame.shutter, frame.aperture, frame.focal, frame.place].filter(Boolean).join(' · ') : '';

  return createPortal(
    <AnimatePresence>
      {frame && (
        <motion.div className={`viewer ${chrome ? '' : 'immersive'}`} role="dialog" aria-modal="true" aria-label="查看扫描件" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: level === 'off' ? 0 : 0.18 }}>
          <div className="viewer-top">
            <button className="icon-btn" onClick={() => setIndex(null)} aria-label="关闭">✕</button>
            <span className="mono">{frame.order + 1} / {frames.length}</span>
            <span className="viewer-zoom mono">{scale > 1.01 ? `${Math.round(scale * 100)}%` : ''}</span>
          </div>
          <div className="viewer-stage">
            <ZoomPan
              key={frame.id + frame.photoId}
              src={url}
              thumb={thumbUrl}
              compareSrc={cmp ? origUrl : undefined}
              alt={`第 ${frame.order + 1} 张`}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onClose={() => setIndex(null)}
              onTap={() => setChrome((c) => !c)}
              onScale={setScale}
            />
            <button className="viewer-nav left" onClick={() => go(-1)} disabled={index === 0} aria-label="上一张">‹</button>
            <button className="viewer-nav right" onClick={() => go(1)} disabled={index === frames.length - 1} aria-label="下一张">›</button>
          </div>
          <div className="viewer-filmstrip" ref={stripRef} aria-label="缩略图">
            {frames.map((f, i) => (
              <button key={f.id} className={`vthumb ${i === index ? 'on' : ''}`} onClick={() => setIndex(i)} aria-label={`第 ${f.order + 1} 张`} aria-current={i === index}>
                <Thumb photoId={f.thumbId} />
              </button>
            ))}
          </div>
          <div className="viewer-info" key={frame.id}>
            <button className="viewer-summary" onClick={() => setInfoOpen((o) => !o)} aria-expanded={infoOpen}>
              <span className={summary ? '' : 'muted'}>{summary || '还没有拍摄信息'}</span>
              <span className="viewer-edit">{infoOpen ? '收起' : '编辑'}</span>
            </button>
            {infoOpen && (
              <div className="viewer-fields">
                {FIELDS.map((f) => (
                  <label key={f.key} className={`vfield ${f.wide ? 'wide' : ''}`}>
                    <span>{f.label}</span>
                    <input
                      id={`frame-${f.key}`}
                      defaultValue={frame[f.key] ?? ''}
                      placeholder={f.ph}
                      onBlur={(e) => { const val = e.target.value.trim(); if (val !== (frame[f.key] ?? '')) updateFrame(frame.id, { [f.key]: val || undefined }); }}
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="row-btns">
              {frame.origPhotoId && <button className={`btn small ghost ${cmp ? 'on' : ''}`} aria-pressed={cmp} onClick={() => setCmp((c) => !c)}>前后对比</button>}
              <button className="btn small ghost" onClick={() => setDevOpen(true)}>{frame.edit ? '已处理 · 再调整' : '底片处理'}</button>
              {url && <a className="btn small ghost" href={url} download={`frame-${frame.order + 1}.jpg`}>保存图片</a>}
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
      {frame && devOpen && <Develop key={frame.id + (frame.edit ? 'e' : 'o')} frame={frame} onClose={() => setDevOpen(false)} />}
    </AnimatePresence>,
    document.body,
  );
}

/** 把缩略图拼成一张「底片条索引图」PNG 并下载 */
