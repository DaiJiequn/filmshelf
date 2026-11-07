import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { db, type Frame } from '../db/schema';
import { canvasesToPdf, canvasToPngBlob, renderSheets, saveBlob, type BandStyle, type Paper, type SheetLayout, type SheetMeta } from '../lib/contact';
import { fmtDate, FORMAT_LABEL } from '../lib/hooks';
import { useToast } from './Toast';
import { Chips } from './ui';

/** 索引图导出：选版面 / 片边风格 / 纸色 / 格式，实时预览，导出 PNG 或 PDF */
export function IndexExport({ rollId, frames, onClose }: { rollId: string; frames: Frame[]; onClose: () => void }) {
  const toast = useToast();
  const [meta, setMeta] = useState<SheetMeta | null>(null);
  const [layout, setLayout] = useState<SheetLayout>('a4');
  const [band, setBand] = useState<BandStyle>('print');
  const [paper, setPaper] = useState<Paper>('white');
  const [fmt, setFmt] = useState<'png' | 'pdf'>('pdf');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    (async () => {
      const roll = await db.rolls.get(rollId);
      if (!roll) return;
      const [stock, camera, visit] = await Promise.all([
        db.stocks.get(roll.stockId),
        roll.cameraId ? db.cameras.get(roll.cameraId) : undefined,
        roll.labVisitId ? db.labVisits.get(roll.labVisitId) : undefined,
      ]);
      const lab = visit ? await db.labs.get(visit.labId) : undefined;
      const name = stock ? `${stock.brand} ${stock.name}` : '胶卷索引';
      const l1 = [stock ? `ISO ${roll.shotIso ?? stock.iso}` : '', FORMAT_LABEL[roll.format], `${frames.length} 张`].filter(Boolean).join(' · ');
      const l2 = [camera?.name, roll.loadedAt ? fmtDate(roll.loadedAt) : ''].filter(Boolean).join(' · ');
      const l3 = [lab?.name, visit?.backAt ? `取回 ${fmtDate(visit.backAt)}` : ''].filter(Boolean).join(' · ');
      setMeta({ title: name, lines: [l1, l2, l3].filter(Boolean), format: roll.format, edgeText: stock?.name ?? '', bw: stock?.type === 'bw' });
    })();
  }, [rollId, frames.length]);

  useEffect(() => {
    if (!meta) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const cs = await renderSheets(frames, meta, { layout, band, paper, width: 760 });
        if (my === seq.current) setPreview(cs[0].toDataURL('image/jpeg', 0.85));
      } catch { /* 预览失败不影响导出 */ }
    }, 120);
    return () => clearTimeout(t);
  }, [meta, frames, layout, band, paper]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const exportNow = async () => {
    if (!meta) return;
    setBusy(true);
    try {
      const cs = await renderSheets(frames, meta, { layout, band, paper });
      const base = `index-${meta.title.replace(/\s+/g, '-')}`;
      if (fmt === 'pdf') saveBlob(await canvasesToPdf(cs), `${base}.pdf`);
      else for (let i = 0; i < cs.length; i++) saveBlob(await canvasToPngBlob(cs[i]), `${base}${cs.length > 1 ? `-${i + 1}` : ''}.png`);
      toast.show('索引图已导出');
      onClose();
    } catch (e) {
      toast.show((e as Error).message || '导出失败', { tone: 'error' });
      setBusy(false);
    }
  };

  return createPortal(
    <div className="ixp-back" onClick={() => !busy && onClose()}>
      <div className="ixp" role="dialog" aria-modal="true" aria-label="导出索引图" onClick={(e) => e.stopPropagation()}>
        <div className="ixp-head"><b>导出索引图</b><button className="icon-btn" onClick={onClose} aria-label="关闭" disabled={busy}>✕</button></div>
        <div className="ixp-preview">{preview ? <img src={preview} alt="索引图预览" /> : <span className="muted">生成预览…</span>}</div>
        <div className="ixp-opts">
          <div><span>版面</span><Chips<SheetLayout> value={layout} onChange={setLayout} options={[{ value: 'a4', label: 'A4 纸' }, { value: 'long', label: '长图' }]} /></div>
          <div><span>片边</span><Chips<BandStyle> value={band} onChange={setBand} options={[{ value: 'print', label: '印相黑' }, { value: 'base', label: '片基色' }]} /></div>
          <div><span>纸色</span><Chips<Paper> value={paper} onChange={setPaper} options={[{ value: 'white', label: '白纸' }, { value: 'dark', label: '深色' }]} /></div>
          <div><span>格式</span><Chips<'png' | 'pdf'> value={fmt} onChange={setFmt} options={[{ value: 'pdf', label: 'PDF' }, { value: 'png', label: 'PNG' }]} /></div>
        </div>
        <button className="btn primary block" onClick={exportNow} disabled={!meta || busy}>{busy ? '正在生成…' : `导出 ${fmt.toUpperCase()}`}</button>
      </div>
    </div>,
    document.body,
  );
}
