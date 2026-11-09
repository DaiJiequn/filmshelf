import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/Confirm';
import { PageHeader } from '../components/PageHeader';
import { useSheets } from '../components/SheetHost';
import { useToast } from '../components/Toast';
import { Empty, Segmented, Stepper } from '../components/ui';
import { UpdateRow } from '../components/UpdatePrompt';
import { CloudSyncCard } from '../components/CloudSyncCard';
import { AutoBackupCard } from '../components/AutoBackupCard';
import { clearAll, estimateBackupSize, exportBackupBlob, importBackup, markBackedUp } from '../db/backup';
import { SCAN_QUALITY_LABEL } from '../lib/image';
import { db, uid } from '../db/schema';
import { FORMAT_LABEL, fmtDate, usePhotoUrl, useSettings } from '../lib/hooks';

export function Me() {
  const sheets = useSheets();
  const counts = useLiveQuery(async () => ({
    cameras: await db.cameras.filter((c) => !c.retired).count(),
    labs: await db.labs.count(),
    locations: await db.locations.count(),
    rolls: await db.rolls.count(),
  }), []);
  const rows = [
    { to: '/catalog', label: '胶卷图鉴' },
    { to: '/me/cameras', label: '相机', n: counts?.cameras },
    { to: '/me/labs', label: '冲洗店', n: counts?.labs },
    { to: '/me/locations', label: '存放位置', n: counts?.locations },
    { to: '/me/backup', label: '备份与恢复' },
    { to: '/me/settings', label: '设置' },
  ];
  return (
    <div className="page">
      <PageHeader title="我的" sub={counts ? `共记录 ${counts.rolls} 卷胶卷` : undefined} />
      <div className="menu">
        <button className="menu-row" onClick={() => sheets.openPast()}>
          <span>补录旧胶卷（已冲洗完的）</span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
        {rows.map((r) => (
          <Link key={r.to} to={r.to} className="menu-row">
            <span>{r.label}</span>
            <span className="muted">{r.n !== undefined ? r.n : ''}</span>
            <span className="chev" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CameraRow({ id, name, format, photoId, retired, onEdit }: { id: string; name: string; format: keyof typeof FORMAT_LABEL; photoId?: string; retired: boolean; onEdit: () => void }) {
  const url = usePhotoUrl(photoId);
  return (
    <button key={id} className={`card row-card ${retired ? 'dim' : ''}`} onClick={onEdit}>
      {url ? <img className="thumb" src={url} alt="" /> : <span className="thumb ph">📷</span>}
      <div className="grow">
        <strong>{name}</strong>
        <div className="muted small mono">{FORMAT_LABEL[format]}{retired ? ' · 已封存' : ''}</div>
      </div>
      <span className="chev" aria-hidden="true">›</span>
    </button>
  );
}

export function Cameras() {
  const sheets = useSheets();
  const cams = useLiveQuery(() => db.cameras.toArray(), []);
  return (
    <div className="page">
      <PageHeader title="相机" back right={<button className="btn small primary" onClick={() => sheets.openCamera()}>＋ 新增</button>} />
      {cams && cams.length === 0 ? (
        <Empty title="还没有相机" text="添加你的相机，上卷时才能选择。" action={<button className="btn primary" onClick={() => sheets.openCamera()}>添加相机</button>} />
      ) : (
        <div className="list">
          {(cams ?? []).sort((a, b) => Number(a.retired) - Number(b.retired) || a.name.localeCompare(b.name)).map((c) => (
            <CameraRow key={c.id} id={c.id} name={c.name} format={c.format} photoId={c.photoId} retired={c.retired} onEdit={() => sheets.openCamera(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface NamedItem { id: string; name: string; sub?: string }

function NamedList({
  title, items, placeholder, emptyTitle, emptyText, onAdd, onRename, onDelete, onMove,
}: {
  title: string; items: NamedItem[]; placeholder: string; emptyTitle: string; emptyText: string;
  onAdd: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMove?: (id: string, dir: -1 | 1) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState('');
  return (
    <div className="page">
      <PageHeader title={title} back />
      <form className="add-row" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await onAdd(name.trim()); setName(''); } }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
        <button className="btn primary" disabled={!name.trim()}>添加</button>
      </form>
      {items.length === 0 ? (
        <Empty title={emptyTitle} text={emptyText} />
      ) : (
        <div className="list">
          {items.map((it, i) => (
            <div key={it.id} className="card row-card">
              {editing === it.id ? (
                <>
                  <input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <button className="btn small primary" onClick={async () => { if (draft.trim()) await onRename(it.id, draft.trim()); setEditing(undefined); }}>保存</button>
                </>
              ) : (
                <>
                  <div className="grow">
                    <strong>{it.name}</strong>
                    {it.sub && <div className="muted small">{it.sub}</div>}
                  </div>
                  {onMove && (
                    <>
                      <button className="icon-btn" disabled={i === 0} onClick={() => onMove(it.id, -1)} aria-label="上移">↑</button>
                      <button className="icon-btn" disabled={i === items.length - 1} onClick={() => onMove(it.id, 1)} aria-label="下移">↓</button>
                    </>
                  )}
                  <button className="btn small ghost" onClick={() => { setEditing(it.id); setDraft(it.name); }}>改名</button>
                  <button className="btn small ghost danger-text" onClick={() => onDelete(it.id)}>删除</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Labs() {
  const toast = useToast();
  const { confirm, node } = useConfirm();
  const data = useLiveQuery(async () => ({ labs: await db.labs.toArray(), visits: await db.labVisits.toArray() }), []);
  return (
    <>
      <NamedList
        title="冲洗店"
        placeholder="冲洗店名称"
        emptyTitle="还没有冲洗店"
        emptyText="第一次送冲时也可以直接填写。"
        items={(data?.labs ?? []).map((l) => {
          const vs = (data?.visits ?? []).filter((v) => v.labId === l.id);
          const done = vs.filter((v) => v.backAt);
          const avg = done.length ? Math.round(done.reduce((n, v) => n + (new Date(v.backAt!).getTime() - new Date(v.sentAt).getTime()) / 86400000, 0) / done.length) : undefined;
          return { id: l.id, name: l.name, sub: `送冲 ${vs.length} 次${avg !== undefined ? ` · 平均 ${avg} 天取回` : ''}` };
        })}
        onAdd={async (name) => void (await db.labs.add({ id: uid(), name }))}
        onRename={async (id, name) => void (await db.labs.update(id, { name }))}
        onDelete={async (id) => {
          const used = await db.labVisits.where('labId').equals(id).count();
          if (used) { toast.show(`这家店有 ${used} 条送冲记录，不能删除`, { tone: 'error' }); return; }
          if (await confirm('删除冲洗店？', '这家店没有任何送冲记录。', '删除', true)) await db.labs.delete(id);
        }}
      />
      {node}
    </>
  );
}

export function Locations() {
  const toast = useToast();
  const { confirm, node } = useConfirm();
  const locs = useLiveQuery(() => db.locations.orderBy('order').toArray(), []);
  return (
    <>
      <NamedList
        title="存放位置"
        placeholder="例如 冰箱上层 / 防潮箱"
        emptyTitle="还没有存放位置"
        emptyText="记录胶卷放在哪里，入库时可以选择。"
        items={(locs ?? []).map((l) => ({ id: l.id, name: l.name }))}
        onAdd={async (name) => void (await db.locations.add({ id: uid(), name, order: (locs?.length ?? 0) }))}
        onRename={async (id, name) => void (await db.locations.update(id, { name }))}
        onMove={async (id, dir) => {
          const list = [...(locs ?? [])];
          const i = list.findIndex((l) => l.id === id);
          const j = i + dir;
          if (j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
          await db.transaction('rw', db.locations, async () => {
            for (let k = 0; k < list.length; k++) await db.locations.update(list[k].id, { order: k });
          });
        }}
        onDelete={async (id) => {
          const used = await db.rolls.where('locationId').equals(id).count();
          if (used) { toast.show(`还有 ${used} 卷放在这里，先移走再删除`, { tone: 'error' }); return; }
          if (await confirm('删除这个位置？', '', '删除', true)) await db.locations.delete(id);
        }}
      />
      {node}
    </>
  );
}

export function Backup() {
  const [settings] = useSettings();
  const toast = useToast();
  const { confirm, node } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const [withScans, setWithScans] = useState(true);
  const [sizes, setSizes] = useState<{ withScans: number; withoutScans: number }>();
  const [quota, setQuota] = useState<{ usage: number; quota: number }>();
  useEffect(() => {
    estimateBackupSize().then(setSizes);
    navigator.storage?.estimate?.().then((e) => e.quota && setQuota({ usage: e.usage ?? 0, quota: e.quota }));
  }, []);
  const mb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(0.1, n / 1e6).toFixed(1) + ' MB');

  async function doExport() {
    setBusy(true);
    try {
      const blob = await exportBackupBlob(withScans);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `film-shelf-${new Date().toISOString().slice(0, 10)}${withScans ? '' : '-no-scans'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await markBackedUp();
      toast.show('备份已导出，请保存到「文件」或云盘');
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File) {
    try {
      const json = JSON.parse(await file.text());
      if (!(await confirm('用备份覆盖当前数据？', '导入会替换现在所有的胶卷、相机和设置，无法撤销。建议先导出一份当前数据。', '覆盖导入', true))) return;
      setBusy(true);
      await importBackup(json);
      toast.show('已恢复备份');
    } catch (e) {
      toast.show(e instanceof SyntaxError ? '这不是有效的备份文件' : (e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="备份与恢复" back />
      <div className="card note-card">
        <p>数据只保存在这台设备的浏览器里。清理浏览器数据或卸载桌面图标可能导致丢失，请定期导出备份。</p>
        <p className="muted small">上次备份：{settings.lastBackupAt ? fmtDate(settings.lastBackupAt) : '从未'}</p>
      </div>
      <UpdateRow />
      <AutoBackupCard />
      <CloudSyncCard />
      {sizes && sizes.withScans > sizes.withoutScans + 1000 && (
        <div className="card note-card">
          <div className="seg" role="radiogroup" aria-label="备份内容">
            <button className={`seg-item ${withScans ? 'on' : ''}`} role="radio" aria-checked={withScans} onClick={() => setWithScans(true)}>含扫描件 · {mb(sizes.withScans)}</button>
            <button className={`seg-item ${!withScans ? 'on' : ''}`} role="radio" aria-checked={!withScans} onClick={() => setWithScans(false)}>不含扫描件 · {mb(sizes.withoutScans)}</button>
          </div>
          <p className="muted small">扫描件很占空间。不含扫描件的备份导入时，本机已有的扫描件会保留，不会丢。</p>
        </div>
      )}
      {quota && <p className="muted small">本机已用 {mb(quota.usage)}，浏览器给这个应用的上限约 {mb(quota.quota)}。</p>}
      <div className="stack">
        <button className="btn primary block" disabled={busy} onClick={doExport}>导出备份（JSON）</button>
        <button className="btn ghost block" disabled={busy} onClick={() => fileRef.current?.click()}>从备份恢复…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      </div>
      {node}
    </div>
  );
}

export function SettingsPage() {
  const [s, set] = useSettings();
  const { confirm, node } = useConfirm();
  const toast = useToast();
  return (
    <div className="page">
      <PageHeader title="设置" back />
      <section className="section">
        <h2>动效</h2>
        <Segmented
          value={s.motionLevel}
          onChange={(v) => set('motionLevel', v)}
          options={[{ value: 'full', label: '完整' }, { value: 'lite', label: '简化' }, { value: 'off', label: '关闭' }]}
          ariaLabel="动效等级"
        />
        <p className="muted small">简化：只保留淡入淡出；关闭：没有任何动画。系统开启「减少动态效果」时自动使用简化。</p>
        <Link to="/me/lab" className="link">打开动效实验室 →</Link>
      </section>
      <section className="section">
        <h2>扫描件画质</h2>
        <select className="input" value={s.scanQuality} onChange={(e) => set('scanQuality', e.target.value as typeof s.scanQuality)}>
          {(Object.keys(SCAN_QUALITY_LABEL) as (keyof typeof SCAN_QUALITY_LABEL)[]).map((k) => <option key={k} value={k}>{SCAN_QUALITY_LABEL[k]}</option>)}
        </select>
        <p className="muted small">只影响之后导入的扫描件。缩略图始终是小图。</p>
      </section>
      <section className="section">
        <h2>货币</h2>
        <select className="input" value={s.currency} onChange={(e) => set('currency', e.target.value)}>
          {['JPY', 'CNY', 'USD', 'EUR', 'TWD', 'HKD', 'GBP', 'KRW'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </section>
      <section className="section">
        <h2>快过期提醒</h2>
        <div className="row-btns spread">
          <span className="muted">提前 {s.expiryWarnMonths} 个月提醒</span>
          <Stepper value={s.expiryWarnMonths} min={0} max={12} onChange={(n) => set('expiryWarnMonths', n)} />
        </div>
      </section>
      <section className="section">
        <h2>危险区</h2>
        <button
          className="btn ghost danger-text"
          onClick={async () => {
            if (await confirm('清空所有数据？', '所有胶卷、相机、冲洗记录和照片都会被删除（内置品种保留）。请确认已经备份。', '清空', true)) {
              await clearAll();
              toast.show('已清空');
            }
          }}
        >
          清空所有数据
        </button>
      </section>
      {node}
    </div>
  );
}
