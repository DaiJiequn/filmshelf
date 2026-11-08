import { AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';
import { useUpdater } from '../lib/updater';
import { FilmProgress } from './FilmProgress';
import { Overlay } from './Overlay';

/** 桌面版更新弹窗：发现新版本 → 点「更新」开始下载（带进度条）→ 下载完点「重启」才安装。 */
export function UpdatePrompt() {
  const u = useUpdater();
  const { status, version, percent = 0, message } = u.state;
  const [dismissed, setDismissed] = useState('');
  const [manual, setManual] = useState(false);

  // 出现新状态时重新弹出（稍后再说只对「当前这个版本的当前阶段」生效）
  const key = `${status}:${version ?? ''}`;
  useEffect(() => { if (status === 'checking') setManual(false); }, [status]);

  const open = u.supported && dismissed !== key && (
    status === 'available' || status === 'downloading' || status === 'ready' || (status === 'error' && manual)
  );

  return (
    <AnimatePresence>
      {open && (
        <Overlay label="软件更新" onBackdrop={() => status !== 'downloading' && setDismissed(key)}>
          <div className="ixp-head"><b>{status === 'ready' ? '更新已就绪' : status === 'error' ? '更新失败' : '发现新版本'}</b></div>
          {status === 'available' && (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>胶卷柜 <b>v{version}</b> 已发布。你的数据都在本机，更新不会影响它们。</p>
              <div className="row-btns" style={{ gap: 8 }}>
                <button className="btn" onClick={() => setDismissed(key)}>稍后</button>
                <button className="btn primary" onClick={() => u.download()}>更新</button>
              </div>
            </>
          )}
          {status === 'downloading' && (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>正在下载 v{version ?? ''}…</p>
              <FilmProgress value={percent / 100} />
              <div className="muted" style={{ fontSize: 12 }}>{percent}%{u.state.speed ? ` · ${(u.state.speed / 1048576).toFixed(1)} MB/s` : ''}</div>
            </>
          )}
          {status === 'ready' && (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>v{version} 已下载完成。重启后即可使用新版本。</p>
              <div className="row-btns" style={{ gap: 8 }}>
                <button className="btn" onClick={() => setDismissed(key)}>稍后</button>
                <button className="btn primary" onClick={() => u.install()}>重启并更新</button>
              </div>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>{message || '检查更新时出错。'}</p>
              <div className="row-btns" style={{ gap: 8 }}>
                <button className="btn" onClick={() => setDismissed(key)}>关闭</button>
                <button className="btn primary" onClick={() => u.openReleases()}>去下载页手动更新</button>
              </div>
            </>
          )}
        </Overlay>
      )}
    </AnimatePresence>
  );
}

/** 「我的」页里的检查更新入口（仅桌面版） */
export function UpdateRow() {
  const u = useUpdater();
  if (!u.supported) return null;
  const s = u.state;
  const label =
    s.status === 'checking' ? '检查中…' :
    s.status === 'none' ? '已是最新版本' :
    s.status === 'available' ? `发现 v${s.version}` :
    s.status === 'downloading' ? `下载中 ${s.percent ?? 0}%` :
    s.status === 'ready' ? '等待重启' :
    s.status === 'error' ? '检查失败，点此重试' : '检查更新';
  return (
    <div className="card note-card">
      <div className="row-btns spread">
        <div><b>软件更新</b><div className="muted small">当前版本 v{u.version || '—'}</div></div>
        <button className="btn small" disabled={s.status === 'checking' || s.status === 'downloading'} onClick={() => u.check()}>{label}</button>
      </div>
    </div>
  );
}
