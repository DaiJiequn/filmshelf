import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { db, type Frame } from '../db/schema';
import type { Crop } from '../lib/crop';
import { analyzeRoll, autoAnalyze, autoFrame, autoFrameFor, computeLevels, DEFAULT_GLOSS, defaultMode, DEV_MODE_LABEL, developFrame, developInPlace, fitAspect, IDENTITY, rasterize, revertFrame, sampleLinear, type DevMode, type DevParams } from '../lib/develop';
import { scaled, SPRING, useMotionLevel } from '../motion/tokens';
import { useToast } from './Toast';

type SKey = 'exposure' | 'grade' | 'paperBlack' | 'gloss' | 'white' | 'black' | 'saturation';
const SLIDERS: { key: SKey; label: string; min: number; neg?: boolean; color?: boolean }[] = [
  { key: 'exposure', label: '曝光', min: -100 },
  { key: 'grade', label: '纸号', min: -100 },
  { key: 'paperBlack', label: '黑位', min: -100 },
  { key: 'gloss', label: '高光压', min: 0 },
  { key: 'white', label: '白点', min: -100, neg: true },
  { key: 'black', label: '黑点', min: -100, neg: true },
  { key: 'saturation', label: '饱和', min: -100, color: true },
];
const CH = ['R', 'G', 'B'];

/** 底片处理：把扫描出来的负片反相成正片、去橙色片基、调曝光色彩。预览用小图实时算，保存时用原图全尺寸算。 */
export function Develop({ frame, onClose }: { frame: Frame; onClose: () => void }) {
  const level = useMotionLevel();
  const toast = useToast();
  const [p, setP] = useState<DevParams | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState('');
  const [rev, setRev] = useState(0);
  const [pick, setPick] = useState<'base' | 'gray' | null>(null);
  const [adv, setAdv] = useState(false);
  const [split, setSplit] = useState<number | null>(null);
  const [cropping, setCropping] = useState(false);
  const drag = useRef<{ kind: string; sx: number; sy: number; start: Crop } | null>(null);
  const outImg = useRef<ImageData | null>(null);
  const bmp = useRef<ImageBitmap | null>(null);
  const raw = useRef<ImageData | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);

  // 载入原图
  useEffect(() => {
    let dead = false;
    (async () => {
      const orig = await db.photos.get(frame.origPhotoId ?? frame.photoId);
      if (!orig || dead) return;
      const b = await createImageBitmap(orig.blob, { imageOrientation: 'from-image' });
      if (dead) { b.close?.(); return; }
      bmp.current = b;
      let init: DevParams;
      if (frame.edit?.v === 2) init = { ...IDENTITY, ...frame.edit };
      else {
        const roll = await db.rolls.get(frame.rollId);
        const stock = roll ? await db.stocks.get(roll.stockId) : undefined;
        init = { ...IDENTITY, mode: defaultMode(stock?.type) };
      }
      raw.current = rasterize(b, init.rotate, init.flip, 1200, init.angle);
      if (frame.edit?.v !== 2) init = { ...init, ...autoAnalyze(raw.current, init.mode), gloss: init.mode === 'positive' ? 0 : DEFAULT_GLOSS };
      setP(init);
    })();
    return () => { dead = true; bmp.current?.close?.(); };
  }, [frame.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 旋转/翻转变了就重新取像素
  const geo = p ? `${p.rotate}${p.flip}${p.angle}` : '';
  useEffect(() => {
    if (!p || !bmp.current) return;
    raw.current = rasterize(bmp.current, p.rotate, p.flip, 1200, p.angle);
    setRev((r) => r + 1);
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // 绘制预览
  useEffect(() => {
    const src = raw.current, c = cv.current;
    if (!p || !src || !c) return;
    const id = requestAnimationFrame(() => {
      const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      if (!compare) developInPlace(out.data, p);
      if (split !== null && !compare) {
        // 左半边显示未处理的原图，右半边显示处理结果
        const sx = Math.round((split / 100) * out.width) * 4;
        for (let y = 0; y < out.height; y++) {
          const o = y * out.width * 4;
          out.data.set(src.data.subarray(o, o + sx), o);
        }
      }
      outImg.current = out;
      c.width = out.width; c.height = out.height;
      c.getContext('2d')!.putImageData(out, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [p, compare, rev, split]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const patch = useCallback((x: Partial<DevParams>) => setP((cur) => (cur ? { ...cur, ...x } : cur)), []);
  const setMode = (mode: DevMode) => {
    if (!raw.current) return;
    patch({ mode, gloss: mode === 'positive' ? 0 : DEFAULT_GLOSS, ...autoAnalyze(raw.current, mode) });
  };
  const auto = () => raw.current && p && patch(autoAnalyze(raw.current, p.mode));
  const reset = () => raw.current && p && patch({ exposure: 0, grade: 0, paperBlack: 0, white: 0, black: 0, saturation: 0, shadow: [0, 0, 0], highlight: [0, 0, 0], gloss: p.mode === 'positive' ? 0 : DEFAULT_GLOSS, ...autoAnalyze(raw.current, p.mode) });

  /** 点图取样：片基（点在没曝光的边框上）或灰点（点在应该是中性灰的地方） */
  const onPick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = cv.current, r = raw.current;
    if (!pick || !c || !r || !p) return;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * c.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * c.height);
    if (pick === 'base') {
      const lin = sampleLinear(r, x, y);
      const base = p.mode === 'bw-neg' ? Array(3).fill(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) : lin;
      patch({ base, ...computeLevels(r, p.mode, base) });
    } else if (outImg.current) {
      const o = outImg.current, i = (y * o.width + x) * 4;
      const col = [o.data[i], o.data[i + 1], o.data[i + 2]].map((v) => Math.max(8, v));
      const mean = (col[0] + col[1] + col[2]) / 3;
      patch({ highlight: p.highlight.map((h, k) => Math.max(-100, Math.min(100, ((1 + h / 100) * (mean / col[k]) - 1) * 100))) });
    }
    setPick(null);
  };

  const save = async () => {
    if (!p) return;
    setBusy('正在处理原图…');
    try {
      await developFrame(frame, p);
      toast.show('已保存处理结果（原图仍保留）');
      onClose();
    } catch (e) { toast.show(e instanceof Error ? e.message : '处理失败'); setBusy(''); }
  };

  const batch = async () => {
    if (!p) return;
    const all = await db.frames.where('rollId').equals(frame.rollId).sortBy('order');
    try {
      setBusy('分析整卷…');
      const roll = p.mode === 'positive' ? null : await analyzeRoll(all, p.mode);
      for (let i = 0; i < all.length; i++) {
        setBusy(`整卷处理 ${i + 1} / ${all.length}…`);
        const own = all[i].id === frame.id;
        const rot = own ? p.rotate : (all[i].edit?.rotate ?? 0), flp = own ? p.flip : (all[i].edit?.flip ?? false);
        let geoP: Partial<DevParams> = {};
        if (!own) {
          // 你裁过的话，其余每张各自检测边框（比例沿用）；没裁就都不裁
          if (p.crop) {
            const f = await autoFrameFor(all[i], p.mode, rot, flp);
            const sz = all[i].width && all[i].height ? { W: all[i].width, H: all[i].height } : dims();
            geoP = { angle: f.angle, crop: f.crop && p.aspect ? fitAspect(f.crop, p.aspect, sz.W, sz.H) : f.crop };
          } else geoP = { angle: 0, crop: null };
        }
        await developFrame(all[i], { ...p, ...(roll ?? {}), ...geoP, rotate: rot, flip: flp });
      }
      toast.show(`已处理 ${all.length} 张`);
      onClose();
    } catch (e) { toast.show(e instanceof Error ? e.message : '处理失败'); setBusy(''); }
  };

  const dims = () => ({ W: raw.current?.width ?? 1, H: raw.current?.height ?? 1 });
  const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

  const autoCrop = () => {
    if (!bmp.current || !p) return;
    const r = autoFrame(bmp.current, p.mode, p.rotate, p.flip);
    if (!r.crop) { toast.show('没找到明显的边框，保持整张'); patch({ angle: r.angle }); return; }
    const { W, H } = dims();
    patch({ angle: r.angle, crop: p.aspect ? fitAspect(r.crop, p.aspect, W, H) : r.crop });
    toast.show(`已自动裁切${r.angle ? `，纠偏 ${r.angle}°` : ''}`);
  };
  const setAspect = (a: number | null) => {
    const { W, H } = dims();
    patch({ aspect: a, ...(a ? { crop: fitAspect(p?.crop ?? FULL, a, W, H) } : {}) });
  };

  const dragStart = (kind: string) => (e: React.PointerEvent) => {
    if (!p) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: p.crop ?? FULL };
  };
  const dragMove = (e: React.PointerEvent) => {
    const g = drag.current, wrap = (e.currentTarget as HTMLElement).closest('.dev-canvaswrap') as HTMLElement | null;
    if (!g || !wrap || !p) return;
    const r = wrap.getBoundingClientRect();
    const dx = (e.clientX - g.sx) / r.width, dy = (e.clientY - g.sy) / r.height;
    const { W, H } = dims();
    const MIN = 0.05, s = g.start;
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    if (g.kind === 'move') {
      x0 = cl(s.x + dx, 0, 1 - s.w); y0 = cl(s.y + dy, 0, 1 - s.h); x1 = x0 + s.w; y1 = y0 + s.h;
    } else {
      if (g.kind.includes('w')) x0 = cl(s.x + dx, 0, x1 - MIN);
      if (g.kind.includes('e')) x1 = cl(x1 + dx, x0 + MIN, 1);
      if (g.kind.includes('n')) y0 = cl(s.y + dy, 0, y1 - MIN);
      if (g.kind.includes('s')) y1 = cl(y1 + dy, y0 + MIN, 1);
      if (p.aspect && g.kind.length === 2) {
        // 锁定比例：以对角为锚点，宽度跟随指针，高度由比例决定
        const ratio = (p.aspect * H) / W; // 归一化 w/h
        const ax = g.kind.includes('w') ? s.x + s.w : s.x, ay = g.kind.includes('n') ? s.y + s.h : s.y;
        let w = Math.abs((g.kind.includes('w') ? x0 : x1) - ax);
        const maxW = Math.min(g.kind.includes('w') ? ax : 1 - ax, (g.kind.includes('n') ? ay : 1 - ay) * ratio);
        w = cl(w, MIN, maxW);
        const h = w / ratio;
        x0 = g.kind.includes('w') ? ax - w : ax; x1 = x0 + w;
        y0 = g.kind.includes('n') ? ay - h : ay; y1 = y0 + h;
      }
    }
    patch({ crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
  };
  const dragEnd = () => { drag.current = null; };

  const doRevert = async () => {
    setBusy('正在还原…');
    try { await revertFrame(frame); toast.show('已还原成原图'); onClose(); }
    catch (e) { toast.show(e instanceof Error ? e.message : '还原失败'); setBusy(''); }
  };

  return createPortal(
    <motion.div
      className="dev" role="dialog" aria-modal="true" aria-label="底片处理"
      initial={level === 'full' ? { opacity: 0, y: 40 } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0 }}
      exit={level === 'full' ? { opacity: 0, y: 40 } : { opacity: 0 }}
      transition={level === 'full' ? SPRING.sheet : { duration: scaled(level, 0.2) }}
    >
      <div className="dev-top">
        <button className="btn small ghost" onClick={onClose} disabled={!!busy}>取消</button>
        <b>底片处理</b>
        <button className="btn small primary" onClick={save} disabled={!p || !!busy}>保存</button>
      </div>
      <div className="dev-stage">
        <div className="dev-canvaswrap">
          <canvas ref={cv} className={`dev-canvas ${pick ? 'picking' : ''}`} aria-label="预览" onClick={onPick} />
          {p?.crop && (
            <div className="crop-dim" aria-hidden="true">
              <div style={{ position: 'absolute', left: `${p.crop.x * 100}%`, top: `${p.crop.y * 100}%`, width: `${p.crop.w * 100}%`, height: `${p.crop.h * 100}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,.55)' }} />
            </div>
          )}
          {p?.crop && (
            <div
              className={`crop-box ${cropping ? 'editing' : ''}`}
              style={{ left: `${p.crop.x * 100}%`, top: `${p.crop.y * 100}%`, width: `${p.crop.w * 100}%`, height: `${p.crop.h * 100}%` }}
              onPointerDown={cropping ? dragStart('move') : undefined}
              onPointerMove={cropping ? dragMove : undefined}
              onPointerUp={dragEnd}
              onPointerCancel={dragEnd}
            >
              {cropping && (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).filter((k) => !(p.aspect && k.length === 1)).map((k) => (
                <span key={k} className={`crop-h ${k}`} onPointerDown={dragStart(k)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} aria-label={`裁切 ${k}`} />
              ))}
            </div>
          )}
          {split !== null && (
            <div
              className="cmp-handle"
              role="slider"
              aria-label="对比分割线"
              aria-valuenow={Math.round(split)}
              tabIndex={0}
              style={{ left: `${split}%` }}
              onPointerDown={(e) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
                const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
              }}
            ><span className="cmp-knob">⇆</span></div>
          )}
        </div>
        {pick && <div className="dev-pickhint">{pick === 'base' ? '点一下没有曝光的片基（边框）' : '点一下应该是中性灰的地方'}</div>}
        {(!p || busy) && <div className="dev-busy">{busy || '载入中…'}</div>}
      </div>
      {p && (
        <div className="dev-panel">
          <div className="dev-row" role="radiogroup" aria-label="底片类型">
            {(Object.keys(DEV_MODE_LABEL) as DevMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={p.mode === m} className={`chip ${p.mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{DEV_MODE_LABEL[m]}</button>
            ))}
          </div>
          {SLIDERS.filter((x) => !(x.neg && p.mode === 'positive') && !(x.color && p.mode === 'bw-neg')).map((x) => (
            <label key={x.key} className="dev-slider">
              <span>{x.label}</span>
              <input type="range" min={x.min} max={100} value={p[x.key]} onChange={(e) => patch({ [x.key]: Number(e.target.value) })} onDoubleClick={() => patch({ [x.key]: x.key === 'gloss' && p.mode !== 'positive' ? DEFAULT_GLOSS : 0 })} />
              <output className="mono">{p[x.key]}</output>
            </label>
          ))}
          {p.mode !== 'bw-neg' && (
            <>
              <button className="dev-adv" onClick={() => setAdv((a) => !a)} aria-expanded={adv}>{adv ? '收起' : '展开'}阴影 / 高光偏色</button>
              {adv && (['shadow', 'highlight'] as const).map((g) => CH.map((n, k) => (
                <label key={g + n} className="dev-slider">
                  <span>{g === 'shadow' ? '阴影' : '高光'}{n}</span>
                  <input type="range" min={-100} max={100} value={Math.round(p[g][k])} onChange={(e) => patch({ [g]: p[g].map((v, j) => (j === k ? Number(e.target.value) : v)) })} onDoubleClick={() => patch({ [g]: p[g].map((v, j) => (j === k ? 0 : v)) })} />
                  <output className="mono">{Math.round(p[g][k])}</output>
                </label>
              )))}
            </>
          )}
          <label className="dev-slider">
            <span>角度</span>
            <input type="range" min={-30} max={30} value={Math.round(p.angle * 10)} onChange={(e) => patch({ angle: Number(e.target.value) / 10 })} onDoubleClick={() => patch({ angle: 0 })} />
            <output className="mono">{p.angle.toFixed(1)}°</output>
          </label>
          <div className="dev-row">
            <button className="btn small ghost" onClick={autoCrop}>自动裁切</button>
            <button className={`btn small ghost ${cropping ? 'on' : ''}`} aria-pressed={cropping} onClick={() => { if (!p.crop) patch({ crop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } }); setCropping((c) => !c); }}>{cropping ? '完成裁切' : '手动裁切'}</button>
            {p.crop && <button className="btn small ghost" onClick={() => { patch({ crop: null }); setCropping(false); }}>清除裁切</button>}
          </div>
          {cropping && (
            <div className="dev-row" role="radiogroup" aria-label="裁切比例">
              {([['自由', null], ['3:2', 3 / 2], ['1:1', 1], ['4:3', 4 / 3], ['7:6', 7 / 6], ['5:4', 5 / 4]] as [string, number | null][]).map(([label, a]) => (
                <button key={label} role="radio" aria-checked={p.aspect === a} className={`chip ${p.aspect === a ? 'on' : ''}`} onClick={() => setAspect(a)}>{label}</button>
              ))}
              {p.aspect && p.aspect !== 1 && <button className="chip" onClick={() => setAspect(1 / p.aspect!)}>横 / 竖</button>}
            </div>
          )}
          <div className="dev-row">
            <button className="btn small ghost" onClick={auto} disabled={p.mode === 'positive'}>自动校正</button>
            <button className="btn small ghost" onClick={() => setPick('base')} disabled={p.mode === 'positive'}>点选片基</button>
            <button className="btn small ghost" onClick={() => setPick('gray')} disabled={p.mode === 'bw-neg'}>点选灰点</button>
            <button className="btn small ghost" onClick={() => patch({ rotate: ((p.rotate + 90) % 360) as DevParams['rotate'] })}>旋转 90°</button>
            <button className="btn small ghost" onClick={() => patch({ flip: !p.flip })}>水平翻转</button>
            <button className="btn small ghost" onClick={reset}>重置</button>
            <button className={`btn small ghost ${split !== null ? 'on' : ''}`} aria-pressed={split !== null} onClick={() => setSplit((s) => (s === null ? 50 : null))}>左右对比</button>
            <button
              className="btn small ghost"
              onPointerDown={() => setCompare(true)}
              onPointerUp={() => setCompare(false)}
              onPointerLeave={() => setCompare(false)}
              onPointerCancel={() => setCompare(false)}
            >按住看原图</button>
          </div>
          <div className="dev-row">
            <button className="btn small ghost" onClick={batch} disabled={!!busy}>整卷统一处理</button>
            {frame.origPhotoId && <button className="btn small ghost danger-text" onClick={doRevert} disabled={!!busy}>还原原图</button>}
          </div>
          <p className="muted dev-hint">流程：线性光 → 密度（片基自动取自边框，也可点选）→ 逐通道黑白点 → 印相（曝光、纸号、黑位、高光压缩）。整卷统一会取全卷片基和黑白点的中位数。处理结果替换查看图，原图一直保留。</p>
        </div>
      )}
    </motion.div>,
    document.body,
  );
}
