import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Canister } from '../components/Canister';
import { DigitalHero } from '../components/DigitalHero';
import { PageHeader } from '../components/PageHeader';
import { SCAN_LABEL, useSheets } from '../components/SheetHost';
import { Chips, Empty } from '../components/ui';
import { db, type Frame, type Roll } from '../db/schema';
import { digitState, isDeveloped, shotDate } from '../domain/digital';
import { daysBetween } from '../domain/expiry';
import { STATUS_LABEL } from '../domain/roll-state';
import { fmtDate, FORMAT_LABEL, useSettings } from '../lib/hooks';
import { useGo } from '../lib/nav';
import { setPendingImport } from '../lib/pendingImport';
import { SPRING, useMotionLevel } from '../motion/tokens';
import { Thumb } from './Scans';

const BACKUP_DAYS = 30;
const ACCEPT = 'image/*,.tif,.tiff,.3fr,.fff,.arw,.cr2,.cr3,.crw,.dng,.nef,.nrw,.orf,.pef,.raf,.rw2,.rwl,.srw,.iiq,.erf,.mrw,.kdc,.dcr,.raw,.x3f';
type Sort = 'shot' | 'added';

/** 数字底片库：应用的主页。先选扫描件再选卷；待导入的卷排在最前；可按片种/相机/地点/备注搜到具体哪一张 */
export default function Library() {
  const sheets = useSheets();
  const go = useGo();
  const level = useMotionLevel();
  const [settings] = useSettings();
  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState<Sort>('shot');
  const [picked, setPicked] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendRef = useRef<HTMLElement>(null);
  const data = useLiveQuery(async () => {
    const [rolls, frames, stocks, cameras] = await Promise.all([db.rolls.toArray(), db.frames.toArray(), db.stocks.toArray(), db.cameras.toArray()]);
    return { rolls, frames, stocks, cameras };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const byRoll = new Map<string, Frame[]>();
    for (const f of data.frames) byRoll.set(f.rollId, [...(byRoll.get(f.rollId) ?? []), f]);
    for (const l of byRoll.values()) l.sort((a, b) => a.order - b.order);
    const n = (r: Roll) => byRoll.get(r.id)?.length ?? 0;
    const stockOf = (r: Roll) => data.stocks.find((s) => s.id === r.stockId);
    const camOf = (r: Roll) => data.cameras.find((c) => c.id === r.cameraId);
    const key = (r: Roll) => shotDate(r) ?? ''; // 日期未知的排在最后
    const lastAdded = (r: Roll) => (byRoll.get(r.id) ?? []).reduce((m, f) => (f.createdAt > m ? f.createdAt : m), '');
    const scanned = data.rolls.filter((r) => n(r) > 0);
    const years = [...new Set(scanned.map((r) => key(r).slice(0, 4)).filter(Boolean))].sort().reverse();
    const hasUnknown = scanned.some((r) => !key(r));
    const kw = q.trim().toLowerCase();
    const inc = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ').toLowerCase().includes(kw);
    /** 搜索时命中的那几张；整卷信息命中时返回 null（表示整卷都算） */
    const hitFrames = new Map<string, Frame[] | null>();
    const list = scanned.filter((r) => {
      if (year === 'unknown' ? !!key(r) : year !== 'all' && !key(r).startsWith(year)) return false;
      if (!kw) return true;
      const s = stockOf(r);
      if (inc(s?.brand, s?.name, camOf(r)?.name, r.note, r.neg?.place, FORMAT_LABEL[r.format])) { hitFrames.set(r.id, null); return true; }
      const hit = (byRoll.get(r.id) ?? []).filter((f) => inc(f.place, f.note, f.lens));
      if (hit.length) hitFrames.set(r.id, hit);
      return hit.length > 0;
    }).sort((a, b) => (sort === 'shot' ? key(b).localeCompare(key(a)) : lastAdded(b).localeCompare(lastAdded(a))));
    const pending = data.rolls
      .filter((r) => isDeveloped(r, n(r)) && n(r) === 0)
      .sort((a, b) => key(b).localeCompare(key(a)));
    const recent = [...scanned].sort((a, b) => lastAdded(b).localeCompare(lastAdded(a))).slice(0, 5);
    return { byRoll, stockOf, camOf, years, hasUnknown, list, pending, recent, hitFrames, kw };
  }, [data, q, year, sort]);

  const pick = useCallback((files: FileList | File[] | null) => {
    const list = files ? [...files] : [];
    if (list.length) setPicked(list);
  }, []);
  const putInto = (rollId: string) => {
    if (!picked) return;
    setPendingImport(picked, rollId);
    setPicked(null);
    go(`/roll/${rollId}/scans`);
  };

  if (!data || !view) return <div className="page" />;
  const { rolls, frames } = data;
  const now = new Date();
  const first = rolls.length ? rolls.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), rolls[0].createdAt) : undefined;
  const lastBackup = settings.lastBackupAt ?? first;
  const backupDue = rolls.length > 0 && !!lastBackup && daysBetween(lastBackup, now) >= BACKUP_DAYS;
  const enter = (i: number) => (level === 'full' ? { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING.soft, delay: Math.min(i, 12) * 0.04 } } : {});
  const dateText = (r: Roll) => { const d = shotDate(r); return d ? fmtDate(d) : '日期未知'; };
  const RollPick = ({ r, tag }: { r: Roll; tag?: string }) => {
    const s = view.stockOf(r);
    return (
      <button className="card row-card" onClick={() => putInto(r.id)}>
        <Canister stock={s} size={26} />
        <div className="grow">
          <div className="roll-title">{s ? `${s.brand} ${s.name}` : '未知品种'}</div>
          <div className="roll-sub"><span>{dateText(r)}</span><span className="mono">{FORMAT_LABEL[r.format]}</span>{view.camOf(r) && <span>{view.camOf(r)!.name}</span>}</div>
        </div>
        {tag && <span className="badge">{tag}</span>}
      </button>
    );
  };
  const empty = !frames.length && !view.pending.length;

  return (
    <div
      className={`page ${dragging ? 'drop-on' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
    >
      <PageHeader
        title="数字底片"
        sub={empty ? '把每一卷的扫描件收进来' : `${view.list.length === view.byRoll.size ? view.byRoll.size : `${view.list.length}/${view.byRoll.size}`} 卷 · ${frames.length} 张扫描件`}
        right={<button className="btn small primary" onClick={() => fileRef.current?.click()}>＋ 导入扫描件</button>}
      />
      <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      {dragging && <div className="drop-hint" aria-hidden>松开，导入这些扫描件</div>}

      {empty ? (
        <Empty
          title="还没有数字底片"
          text="选好一卷的扫描件（也可以直接拖进来），再告诉我是哪一卷。会按卷排好，写上片种、相机和日期，导出时自动带上 EXIF。"
          action={
            <div className="stack">
              <button className="btn primary" onClick={() => fileRef.current?.click()}>选择扫描件</button>
              <button className="btn ghost" onClick={() => sheets.openInStock()}>先把新胶卷入库</button>
            </div>
          }
        />
      ) : (
        <>
          <DigitalHero rolls={rolls} frames={frames} onPending={() => pendRef.current?.scrollIntoView({ behavior: level === 'off' ? 'auto' : 'smooth', block: 'start' })} />

          {backupDue && (
            <div className="banner">
              <span>已经 {daysBetween(lastBackup!, now)} 天没有备份了，扫描件只存在这台设备上。</span>
              <Link to="/me/backup" className="btn small">去备份</Link>
            </div>
          )}

          {view.pending.length > 0 && !q && (
            <section className="section" ref={pendRef}>
              <h2>待导入 <small>{view.pending.length} 卷</small></h2>
              <div className="pend-row">
                {view.pending.slice(0, 12).map((r) => {
                  const s = view.stockOf(r);
                  const ext = digitState(r, 0) === 'external';
                  return (
                    <button key={r.id} className="card pend-card" onClick={() => go(`/roll/${r.id}/scans`)}>
                      <Canister stock={s} size={26} />
                      <div className="roll-title">{s ? s.name : '未知品种'}</div>
                      <div className="muted small">{dateText(r).slice(0, 7)} · {FORMAT_LABEL[r.format]}</div>
                      <span className="pend-cta">{ext ? `已${SCAN_LABEL[r.neg!.scanned!]} · 导入 ›` : '导入扫描件 ›'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {view.byRoll.size > 0 && (
            <section className="section">
              <h2>全部扫描件</h2>
              <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索片种、相机、镜头、地点、备注" aria-label="搜索扫描件" />
              <div className="row-btns spread">
                <Chips value={year} onChange={setYear} options={[{ value: 'all', label: '全部年份' }, ...view.years.map((y) => ({ value: y, label: y })), ...(view.hasUnknown ? [{ value: 'unknown', label: '日期未知' }] : [])]} />
                <Chips<Sort> value={sort} onChange={setSort} options={[{ value: 'shot', label: '按拍摄' }, { value: 'added', label: '最近导入' }]} />
              </div>
              {view.list.length === 0 ? (
                <Empty title="没有符合条件的卷" text="换个关键词或年份看看。" />
              ) : (
                <div className="lib-list">
                  {view.list.map((r, i) => {
                    const s = view.stockOf(r);
                    const all = view.byRoll.get(r.id) ?? [];
                    const hit = view.hitFrames.get(r.id);
                    const fs = hit ?? all;
                    const cam = view.camOf(r);
                    const off = r.status !== 'back' && r.status !== 'archived';
                    return (
                      <motion.div key={r.id} className="card lib-roll" {...enter(i)}>
                        <button className="lib-head" onClick={() => go(`/roll/${r.id}/scans`)}>
                          <Canister stock={s} size={26} />
                          <div className="grow">
                            <div className="roll-title">{s ? `${s.brand} ${s.name}` : '未知品种'}</div>
                            <div className="roll-sub">
                              <span>{dateText(r)}</span>
                              <span className="mono">{FORMAT_LABEL[r.format]}</span>
                              {cam && <span>{cam.name}</span>}
                              {off && <span className="txt-warn">仍标记为{STATUS_LABEL[r.status]}</span>}
                            </div>
                          </div>
                          <span className="badge keep">{hit ? `命中 ${hit.length} / ${all.length} 张` : `${all.length} 张`}</span>
                        </button>
                        <div className="lib-strip">
                          {fs.slice(0, 8).map((f) => (
                            <Link key={f.id} to={`/roll/${r.id}/scans?f=${f.id}`} className="lib-cell" aria-label={`打开第 ${f.order + 1} 张`}>
                              <Thumb photoId={f.thumbId} /><i className="mono">{f.order + 1}</i>
                            </Link>
                          ))}
                          {fs.length > 8 && <Link to={`/roll/${r.id}/scans`} className="lib-more mono">+{fs.length - 8}</Link>}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <BottomSheet open={!!picked} onClose={() => setPicked(null)} title={`这 ${picked?.length ?? 0} 张是哪一卷的？`}>
        <div className="stack">
          <button className="btn primary block" onClick={() => { if (picked) setPendingImport(picked); setPicked(null); sheets.openPast(); }}>新建一卷（选片种、日期、相机）</button>
          {view.pending.length > 0 && <h3 className="sheet-h">还没导入扫描件的卷</h3>}
          {view.pending.slice(0, 20).map((r) => <RollPick key={r.id} r={r} />)}
          {view.recent.length > 0 && <h3 className="sheet-h">追加到已有的卷</h3>}
          {view.recent.map((r) => <RollPick key={r.id} r={r} tag={`已有 ${view.byRoll.get(r.id)?.length} 张`} />)}
        </div>
      </BottomSheet>
    </div>
  );
}
