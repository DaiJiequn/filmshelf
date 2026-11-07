import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { db, type Frame } from '../db/schema';
import { analyzeRoll, autoAnalyze, computeLevels, DEFAULT_GLOSS, defaultMode, DEV_MODE_LABEL, developFrame, developInPlace, IDENTITY, rasterize, revertFrame, sampleLinear, type DevMode, type DevParams } from '../lib/develop';
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
  const toast = useToast();
  const [p, setP] = useState<DevParams | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState('');
  const [rev, setRev] = useState(0);
  const [pick, setPick] = useState<'base' | 'gray' | null>(null);
  const [adv, setAdv] = useState(false);
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
      const b = await createImageBitmap(orig.blob);
      if (dead) { b.close?.(); return; }
      bmp.current = b;
      let init: DevParams;
      if (frame.edit?.v === 2) init = frame.edit;
      else {
        const roll = await db.rolls.get(frame.rollId);
        const stock = roll ? await db.stocks.get(roll.stockId) : undefined;
        init = { ...IDENTITY, mode: defaultMode(stock?.type) };
      }
      raw.current = rasterize(b, init.rotate, init.flip, 1200);
      if (frame.edit?.v !== 2) init = { ...init, ...autoAnalyze(raw.current, init.mode), gloss: init.mode === 'positive' ? 0 : DEFAULT_GLOSS };
      setP(init);
    })();
    return () => { dead = true; bmp.current?.close?.(); };
  }, [frame.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 旋转/翻转变了就重新取像素
  const geo = p ? `${p.rotate}${p.flip}` : '';
  useEffect(() => {
    if (!p || !bmp.current) return;
    raw.current = rasterize(bmp.current, p.rotate, p.flip, 1200);
    setRev((r) => r + 1);
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // 绘制预览
  useEffect(() => {
    const src = raw.current, c = cv.current;
    if (!p || !src || !c) return;
    const id = requestAnimationFrame(() => {
      const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      if (!compare) developInPlace(out.data, p);
      outImg.current = out;
      c.width = out.width; c.height = out.height;
      c.getContext('2d')!.putImageData(out, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [p, compare, rev]);

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
        await developFrame(all[i], { ...p, ...(roll ?? {}), rotate: own ? p.rotate : (all[i].edit?.rotate ?? 0), flip: own ? p.flip : (all[i].edit?.flip ?? false) });
      }
      toast.show(`已处理 ${all.length} 张`);
      onClose();
    } catch (e) { toast.show(e instanceof Error ? e.message : '处理失败'); setBusy(''); }
  };

  const doRevert = async () => {
    setBusy('正在还原…');
    try { await revertFrame(frame); toast.show('已还原成原图'); onClose(); }
    catch (e) { toast.show(e instanceof Error ? e.message : '还原失败'); setBusy(''); }
  };

  return createPortal(
    <div className="dev" role="dialog" aria-modal="true" aria-label="底片处理">
      <div className="dev-top">
        <button className="btn small ghost" onClick={onClose} disabled={!!busy}>取消</button>
        <b>底片处理</b>
        <button className="btn small primary" onClick={save} disabled={!p || !!busy}>保存</button>
      </div>
      <div className="dev-stage">
        <canvas ref={cv} className={`dev-canvas ${pick ? 'picking' : ''}`} aria-label="预览" onClick={onPick} />
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
          <div className="dev-row">
            <button className="btn small ghost" onClick={auto} disabled={p.mode === 'positive'}>自动校正</button>
            <button className="btn small ghost" onClick={() => setPick('base')} disabled={p.mode === 'positive'}>点选片基</button>
            <button className="btn small ghost" onClick={() => setPick('gray')} disabled={p.mode === 'bw-neg'}>点选灰点</button>
            <button className="btn small ghost" onClick={() => patch({ rotate: ((p.rotate + 90) % 360) as DevParams['rotate'] })}>旋转 90°</button>
            <button className="btn small ghost" onClick={() => patch({ flip: !p.flip })}>水平翻转</button>
            <button className="btn small ghost" onClick={reset}>重置</button>
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
    </div>,
    document.body,
  );
}
