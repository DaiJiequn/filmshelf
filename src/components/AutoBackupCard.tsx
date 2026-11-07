import { useEffect, useState } from 'react';
import { autoBackupSupported, forgetFolder, getConfig, getFolder, pickFolder, restoreFromFolder, runBackup, setConfig, type AutoBackupConfig } from '../lib/autobackup';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { Chips } from './ui';

/** 备份页里的「自动备份到文件夹」卡片 */
export function AutoBackupCard() {
  const toast = useToast();
  const { confirm, node } = useConfirm();
  const [cfg, setCfg] = useState<AutoBackupConfig>(getConfig);
  const [folder, setFolder] = useState<string>('');
  const [busy, setBusy] = useState('');
  const supported = autoBackupSupported();

  useEffect(() => { getFolder().then((d) => setFolder(d?.name ?? '')); }, []);
  const update = (c: AutoBackupConfig) => { setCfg(c); setConfig(c); };

  const pick = async () => {
    try {
      const d = await pickFolder();
      setFolder(d.name);
      if (!cfg.enabled) update({ ...cfg, enabled: true });
      await backupNow();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.show((e as Error).message, { tone: 'error' });
    }
  };
  const backupNow = async () => {
    setBusy('备份中…');
    try {
      const r = await runBackup({ ask: true, onProgress: (d, t) => setBusy(`备份中 ${d}/${t}`) });
      toast.show(r.photosWritten ? `已备份，新增 ${r.photosWritten} 张图片` : '已备份（没有新图片）');
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    } finally { setBusy(''); }
  };
  const restore = async () => {
    if (!(await confirm('从备份文件夹恢复？', '会用文件夹里的内容覆盖当前所有数据，无法撤销。', '覆盖恢复', true))) return;
    setBusy('恢复中…');
    try { await restoreFromFolder(); toast.show('已从文件夹恢复'); }
    catch (e) { toast.show((e as Error).message, { tone: 'error' }); }
    finally { setBusy(''); }
  };
  const unlink = async () => { await forgetFolder(); setFolder(''); update({ ...cfg, enabled: false }); };

  if (!supported) {
    return <div className="card note-card"><b>自动备份到文件夹</b><p className="muted small">当前浏览器不支持。请使用 Chrome / Edge 或桌面版，或继续用下面的手动导出。</p></div>;
  }
  return (
    <div className="card note-card">
      <b>自动备份到文件夹</b>
      <p className="muted small">选一个文件夹（比如网盘同步目录），数据和图片会存在里面。图片只写新增的，之后每次很快。</p>
      <div className="row-btns spread">
        <span className="muted small">{folder ? `已选：${folder}` : '还没有选择文件夹'}</span>
        <button className="btn small" disabled={!!busy} onClick={pick}>{folder ? '更换' : '选择文件夹'}</button>
      </div>
      {folder && (
        <>
          <div className="ixp-opts" style={{ marginTop: 8 }}>
            <div><span>自动</span><Chips<string> value={cfg.enabled ? String(cfg.everyDays) : '0'} onChange={(v) => update({ ...cfg, enabled: v !== '0', everyDays: v === '0' ? cfg.everyDays : +v })} options={[{ value: '0', label: '关' }, { value: '1', label: '每天' }, { value: '7', label: '每周' }]} /></div>
            <div><span>内容</span><Chips<string> value={cfg.withScans ? 'y' : 'n'} onChange={(v) => update({ ...cfg, withScans: v === 'y' })} options={[{ value: 'y', label: '含扫描件' }, { value: 'n', label: '不含' }]} /></div>
          </div>
          <div className="row-btns" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn small primary" disabled={!!busy} onClick={backupNow}>{busy || '立即备份'}</button>
            <button className="btn small ghost" disabled={!!busy} onClick={restore}>从文件夹恢复</button>
            <button className="btn small ghost" disabled={!!busy} onClick={unlink}>取消关联</button>
          </div>
          <p className="muted small">自动备份在打开应用时检查；浏览器重启后可能要点一次「立即备份」重新授权。</p>
        </>
      )}
      {node}
    </div>
  );
}
