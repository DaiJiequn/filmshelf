import { useEffect, useRef, useState } from 'react';
import type { Frame } from '../db/schema';
import { dustFrame, type DustPolarity } from '../lib/dust';
import { FilmProgress } from './FilmProgress';
import { Overlay } from './Overlay';
import { useToast } from './Toast';
import { Chips } from './ui';

/** 自动除尘：灰尘、划痕、毛发。后台运行，可取消；结果替换查看图，原图保留。 */
export function DustDialog({ frame, onClose }: { frame: Frame; onClose: () => void }) {
  const toast = useToast();
  const [pol, setPol] = useState<DustPolarity>('auto');
  const [sens, setSens] = useState(1);
  const [busy, setBusy] = useState(false);
  const [frac, setFrac] = useState(0);
  const [text, setText] = useState('');
  const job = useRef<{ cancel: () => void } | null>(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; job.current?.cancel(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true); setFrac(0); setText('准备中…');
    const j = dustFrame(frame, { polarity: pol, sensitivity: sens }, (f, t) => { if (alive.current) { setFrac(f); setText(t); } });
    job.current = j;
    try {
      const n = await j.promise;
      toast.show(n > 0 ? `除尘完成，清除了 ${n} 处` : '没有发现需要清除的灰尘');
      onClose();
    } catch (e) {
      if (alive.current) { toast.show((e as Error).message || '除尘失败', { tone: 'error' }); setBusy(false); }
    }
  };
  const cancel = () => { job.current?.cancel(); setBusy(false); };

  return (
    <Overlay label="自动除尘" onBackdrop={() => !busy && onClose()}>
      <>
        <div className="ixp-head"><b>自动除尘</b><button className="icon-btn" onClick={onClose} aria-label="关闭" disabled={busy}>✕</button></div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          自动识别并修补灰尘、划痕和毛发，结果替换当前查看图，原图保留，随时可在「底片处理」里还原。大图需要十几秒到几分钟，请保持页面打开。
        </p>
        <div className="ixp-opts">
          <div><span>类型</span><Chips<DustPolarity> value={pol} onChange={setPol} options={[{ value: 'auto', label: '自动' }, { value: 'white', label: '亮点' }, { value: 'dark', label: '暗点' }]} /></div>
          <div><span>灵敏</span><Chips<string> value={String(sens)} onChange={(v) => setSens(+v)} options={[{ value: '0.7', label: '保守' }, { value: '1', label: '标准' }, { value: '1.4', label: '积极' }]} /></div>
        </div>
        {busy && (
          <div>
            <FilmProgress value={frac} />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{text} · {Math.round(frac * 100)}%</div>
          </div>
        )}
        {busy
          ? <button className="btn block" onClick={cancel}>取消</button>
          : <button className="btn primary block" onClick={run}>开始除尘</button>}
      </>
    </Overlay>
  );
}
