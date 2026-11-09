import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canister } from '../components/Canister';
import { DigitalHero, isDigitized } from '../components/DigitalHero';
import { PageHeader } from '../components/PageHeader';
import { useSheets } from '../components/SheetHost';
import { Chips, Empty } from '../components/ui';
import { db, type Frame, type Roll } from '../db/schema';
import { daysBetween } from '../domain/expiry';
import { fmtDate, FORMAT_LABEL, useSettings } from '../lib/hooks';
import { useGo } from '../lib/nav';
import { SPRING, useMotionLevel } from '../motion/tokens';
import { Thumb } from './Scans';

const BACKUP_DAYS = 30;
type Sort = 'shot' | 'added';

/** 数字底片库：应用的主页。所有已扫描的卷按卷成条展示，待数字化的卷排在最前，可按片种/相机/地点/备注搜索 */
export default function Library() {
  const sheets = useSheets();
  const go = useGo();
  const level = useMotionLevel();
  const [settings] = useSettings();
  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState<Sort>('shot');
  const data = useLiveQuery(async () => {
    const [rolls, frames, stocks, cameras] = await Promise.all([db.rolls.toArray(), db.frames.toArray(), db.stocks.toArray(), db.cameras.toArray()]);
    return { rolls, frames, stocks, cameras };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const byRoll = new Map<string, Frame[]>();
    for (const f of data.frames) byRoll.set(f.rollId, [...(byRoll.get(f.rollId) ?? []), f]);
    for (const l of byRoll.values()) l.sort((a, b) => a.order - b.order);
    const frameRolls = new Set(byRoll.keys());
    const stockOf = (r: Roll) => data.stocks.find((s) => s.id === r.stockId);
    const camOf = (r: Roll) => data.cameras.find((c) => c.id === r.cameraId);
    const dateOf = (r: Roll) => r.unloadedAt ?? r.loadedAt ?? r.createdAt;
    const lastAdded = (r: Roll) => (byRoll.get(r.id) ?? []).reduce((m, f) => (f.createdAt > m ? f.createdAt : m), '');
    const scanned = data.rolls.filter((r) => byRoll.has(r.id));
    const years = [...new Set(scanned.map((r) => dateOf(r).slice(0, 4)))].sort().reverse();
    const kw = q.trim().toLowerCase();
    const match = (r: Roll) => {
      if (year !== 'all' && !dateOf(r).startsWith(year)) return false;
      if (!kw) return true;
      const s = stockOf(r);
      const hay = [s?.brand, s?.name, camOf(r)?.name, r.note, r.neg?.place, FORMAT_LABEL[r.format], ...(byRoll.get(r.id) ?? []).flatMap((f) => [f.place, f.note])]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(kw);
    };
    const list = scanned.filter(match).sort((a, b) => (sort === 'shot' ? dateOf(b).localeCompare(dateOf(a)) : lastAdded(b).localeCompare(lastAdded(a))));
    const pending = data.rolls
      .filter((r) => (r.status === 'back' || r.status === 'archived') && !isDigitized(r, frameRolls))
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    const hits = kw ? list.reduce((n, r) => n + (byRoll.get(r.id)?.length ?? 0), 0) : 0;
    return { byRoll, stockOf, camOf, dateOf, years, list, pending, hits };
  }, [data, q, year, sort]);

  if (!data || !view) return <div className="page" />;
  const { rolls, frames } = data;
  const now = new Date();
  const first = rolls.length ? rolls.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), rolls[0].createdAt) : undefined;
  const lastBackup = settings.lastBackupAt ?? first;
  const backupDue = rolls.length > 0 && !!lastBackup && daysBetween(lastBackup, now) >= BACKUP_DAYS;
  const enter = (i: number) => (level === 'full' ? { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING.soft, delay: Math.min(i, 12) * 0.04 } } : {});

  if (!frames.length && !view.pending.length) {
    return (
      <div className="page">
        <PageHeader title="数字底片" sub="把每一卷的扫描件收进来" />
        <Empty
          title="还没有数字底片"
          text="补录一卷已经冲扫好的胶卷，把扫描件导进来；会按卷排好，写上片种、相机和日期，导出时自动带上 EXIF。"
          action={
            <div className="stack">
              <button className="btn primary" onClick={() => sheets.openPast()}>补录一卷，导入扫描件</button>
              <button className="btn ghost" onClick={() => sheets.openInStock()}>先把新胶卷入库</button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="数字底片"
        sub={`${view.list.length === view.byRoll.size ? view.byRoll.size : `${view.list.length}/${view.byRoll.size}`} 卷 · ${frames.length} 张扫描件`}
        right={<button className="btn small primary" onClick={() => sheets.openPast()}>＋ 导入一卷</button>}
      />

      <DigitalHero rolls={rolls} frames={frames} />

      {backupDue && (
        <div className="banner">
          <span>已经 {daysBetween(lastBackup!, now)} 天没有备份了，扫描件只存在这台设备上。</span>
          <Link to="/me/backup" className="btn small">去备份</Link>
        </div>
      )}

      {view.pending.length > 0 && !q && (
        <section className="section">
          <h2>待数字化 <small>{view.pending.length} 卷</small></h2>
          <div className="pend-row">
            {view.pending.slice(0, 12).map((r) => {
              const s = view.stockOf(r);
              return (
                <button key={r.id} className="card pend-card" onClick={() => go(`/roll/${r.id}/scans`)}>
                  <Canister stock={s} size={26} />
                  <div className="roll-title">{s ? s.name : '未知品种'}</div>
                  <div className="muted small">{fmtDate(view.dateOf(r)).slice(0, 7)} · {FORMAT_LABEL[r.format]}</div>
                  <span className="pend-cta">导入扫描件 ›</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {view.byRoll.size > 0 && (
        <section className="section">
          <h2>全部扫描件</h2>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索片种、相机、地点、备注" aria-label="搜索扫描件" />
          <div className="row-btns spread">
            <Chips value={year} onChange={setYear} options={[{ value: 'all', label: '全部年份' }, ...view.years.map((y) => ({ value: y, label: y }))]} />
            <Chips<Sort> value={sort} onChange={setSort} options={[{ value: 'shot', label: '按拍摄' }, { value: 'added', label: '最近导入' }]} />
          </div>
          {q && <p className="muted small">找到 {view.list.length} 卷 · {view.hits} 张</p>}
          {view.list.length === 0 ? (
            <Empty title="没有符合条件的卷" text="换个关键词或年份看看。" />
          ) : (
            <div className="lib-list">
              {view.list.map((r, i) => {
                const s = view.stockOf(r);
                const fs = view.byRoll.get(r.id) ?? [];
                const cam = view.camOf(r);
                return (
                  <motion.div key={r.id} className="card lib-roll" {...enter(i)}>
                    <button className="lib-head" onClick={() => go(`/roll/${r.id}/scans`)}>
                      <Canister stock={s} size={26} />
                      <div className="grow">
                        <div className="roll-title">{s ? `${s.brand} ${s.name}` : '未知品种'}</div>
                        <div className="roll-sub">
                          <span>{fmtDate(view.dateOf(r))}</span>
                          <span className="mono">{FORMAT_LABEL[r.format]}</span>
                          {cam && <span>{cam.name}</span>}
                        </div>
                      </div>
                      <span className="badge keep">{fs.length} 张</span>
                    </button>
                    <Link to={`/roll/${r.id}/scans`} className="lib-strip" aria-label="打开这卷的扫描件">
                      {fs.slice(0, 8).map((f) => (
                        <span key={f.id} className="lib-cell"><Thumb photoId={f.thumbId} /><i className="mono">{f.order + 1}</i></span>
                      ))}
                      {fs.length > 8 && <span className="lib-more mono">+{fs.length - 8}</span>}
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
