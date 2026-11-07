import { useState } from 'react';
import { ConflictError, checkCloud, gAutoOn, gClientId, gLastSync, setGAuto, setGClientId, syncDown, syncUp } from '../lib/gdrive';
import { fmtDate } from '../lib/hooks';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';

/** 备份页里的「Google Drive 同步」卡片 */
export function CloudSyncCard() {
  const toast = useToast();
  const { confirm, node } = useConfirm();
  const [cid, setCid] = useState(gClientId());
  const [auto, setAuto] = useState(gAutoOn());
  const [busy, setBusy] = useState('');
  const [, bump] = useState(0);
  const desktop = location.protocol === 'file:';
  const ready = !!gClientId();

  const run = async (fn: () => Promise<string>) => {
    setBusy('请稍候…');
    try { toast.show(await fn()); }
    catch (e) { toast.show((e as Error).message, { tone: 'error' }); }
    finally { setBusy(''); bump((n) => n + 1); }
  };

  const up = () => run(async () => {
    try {
      const r = await syncUp({ onProgress: setBusy });
      return r.photos ? `已同步到 Google Drive，上传了 ${r.photos} 张图片` : '已同步到 Google Drive';
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      if (!(await confirm('云端有更新的数据', `另一台设备在 ${fmtDate(e.cloudAt)} 上传过更新的数据。用本机覆盖云端，会丢掉那边的改动；也可以先取消，改为「从云端恢复」。`, '用本机覆盖云端', true))) return '已取消';
      await syncUp({ force: true, onProgress: setBusy });
      return '已用本机数据覆盖云端';
    }
  });
  const down = () => run(async () => {
    const st = await checkCloud();
    if (!st.hasCloud) return '云端还没有数据';
    if (!(await confirm('从云端恢复？', `会用云端（${fmtDate(st.cloudAt)}）的数据覆盖本机所有记录，无法撤销。`, '覆盖本机', true))) return '已取消';
    const r = await syncDown({ onProgress: setBusy });
    return r.photos ? `已从云端恢复，下载了 ${r.photos} 张图片` : '已从云端恢复';
  });

  return (
    <div className="card note-card">
      <b>Google Drive 同步</b>
      <p className="muted small">数据存在 Google Drive 里本应用专属的隐藏空间，别的应用和你的文件列表都看不到。多台设备用同一个 Google 账号即可共享。</p>
      {desktop ? (
        <p className="muted small">桌面版暂不支持登录 Google，请在网页版里同步；桌面版可用上面的「自动备份到文件夹」。</p>
      ) : (
        <>
          <label className="muted small" htmlFor="gcid">Google 客户端 ID</label>
          <input id="gcid" className="input" placeholder="xxxx.apps.googleusercontent.com" value={cid}
            onChange={(e) => setCid(e.target.value)} onBlur={() => { setGClientId(cid); bump((n) => n + 1); }} />
          {ready && (
            <>
              <p className="muted small">上次同步：{gLastSync() ? fmtDate(gLastSync()) : '从未'}</p>
              <div className="row-btns" style={{ flexWrap: 'wrap' }}>
                <button className="btn small primary" disabled={!!busy} onClick={up}>{busy || '上传到云端'}</button>
                <button className="btn small ghost" disabled={!!busy} onClick={down}>从云端恢复</button>
              </div>
              <label className="row-btns spread" style={{ marginTop: 8 }}>
                <span className="muted small">打开应用时自动上传（每 6 小时一次，遇到冲突会提示）</span>
                <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setGAuto(e.target.checked); }} />
              </label>
            </>
          )}
        </>
      )}
      {node}
    </div>
  );
}
