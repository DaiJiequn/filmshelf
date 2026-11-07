import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { db, type Frame } from '../db/schema';
import { computeLevels, defaultMode, DEV_MODE_LABEL, developFrame, developInPlace, IDENTITY, rasterize, revertFrame, type DevMode, type DevParams } from '../lib/develop';
import { useToast } from './Toast';

const SLIDERS: { key: 'exposure' | 'contrast' | 'temp' | 'saturation'; label: string }[] = [
  { key: 'exposure', label: '曝光' },
  { key: 'contrast', label: '对比' },
  { key: 'temp', label: '色温' },
  { key: 'saturation', label: '饱和' },
];

/** 底片处理：把扫描出来的负片反相成正片、去橙色片基、调曝光色彩。预览用小图实时算，保存时用原图全尺寸算。 */
export function Develop({ frame, onClose }: { frame: Frame; onClose: () => void }) {
  const toast = useToast();
  const [p, setP] = useState<DevParams | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState('');
  const [rev, setRev] = useState(0);
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
      if (frame.edit) init = frame.edit;
      else {
        const roll = await db.rolls.get(frame.rollId);
        const stock = roll ? await db.stocks.get(roll.stockId) : undefined;
        init = { ...IDENTITY, mode: defaultMode(stock?.type) };
      }
      raw.current = rasterize(b, init.rotate, init.flip, 1200);
      if (!frame.edit) init = { ...init, ...computeLevels(raw.current.data, init.mode) };
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
    patch({ mode, ...(mode === 'positive' ? { lo: [0, 0, 0], hi: [255, 255, 255] } : computeLevels(raw.current.data, mode)) });
  };
  const auto = () => raw.current && p && patch(computeLevels(raw.current.data, p.mode));
  const reset = () => raw.current && p && patch({ exposure: 0, contrast: 0, temp: 0, saturation: 0, ...(p.mode === 'positive' ? {} : computeLevels(raw.current.data, p.mode)) });

  const save = async () => {
    if (!p) return;
    setBusy('正在处理原图…');
    try {
      await developFrame(frame, p, false);
      toast.show('已保存处理结果（原图仍保留）');
      onClose();
    } catch (e) { toast.show(e instanceof Error ? e.message : '处理失败'); setBusy(''); }
  };

  const batch = async () => {
    if (!p) return;
    const all = await db.frames.where('rollId').equals(frame.rollId).sortBy('order');
    try {
      for (let i = 0; i < all.length; i++) {
        setBusy(`整卷处理 ${i + 1} / ${all.length}…`);
        // 当前这张用你调好的参数；其余每张重新自动算黑白点（沿用其余调整）
        await developFrame(all[i], { ...p, rotate: all[i].id === frame.id ? p.rotate : (all[i].edit?.rotate ?? 0), flip: all[i].id === frame.id ? p.flip : (all[i].edit?.flip ?? false) }, all[i].id !== frame.id);
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
        <canvas ref={cv} className="dev-canvas" aria-label="预览" />
        {(!p || busy) && <div className="dev-busy">{busy || '载入中…'}</div>}
      </div>
      {p && (
        <div className="dev-panel">
          <div className="dev-row" role="radiogroup" aria-label="底片类型">
            {(Object.keys(DEV_MODE_LABEL) as DevMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={p.mode === m} className={`chip ${p.mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{DEV_MODE_LABEL[m]}</button>
            ))}
          </div>
          {SLIDERS.filter((s) => !(p.mode === 'bw-neg' && s.key !== 'exposure' && s.key !== 'contrast')).map((s) => (
            <label key={s.key} className="dev-slider">
              <span>{s.label}</span>
              <input type="range" min={-100} max={100} value={p[s.key]} onChange={(e) => patch({ [s.key]: Number(e.target.value) })} onDoubleClick={() => patch({ [s.key]: 0 })} />
              <output className="mono">{p[s.key]}</output>
            </label>
          ))}
          <div className="dev-row">
            <button className="btn small ghost" onClick={auto} disabled={p.mode === 'positive'}>自动校正</button>
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
            <button className="btn small ghost" onClick={batch} disabled={!!busy}>用这组设置处理整卷</button>
            {frame.origPhotoId && <button className="btn small ghost danger-text" onClick={doRevert} disabled={!!busy}>还原原图</button>}
          </div>
          <p className="muted dev-hint">彩色负片会逐通道拉伸来抵消橙色片基；处理后的结果替换查看图，导入时的原图一直保留，随时可以还原。</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
