import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Canister } from '../components/Canister';
import { PageHeader } from '../components/PageHeader';
import { RollCard } from '../components/RollCard';
import { useSheets } from '../components/SheetHost';
import { Empty } from '../components/ui';
import { db } from '../db/schema';
import { daysBetween, expiryState } from '../domain/expiry';
import { FORMAT_LABEL, useSettings } from '../lib/hooks';
import { useGo } from '../lib/nav';
import { SPRING, useMotionLevel } from '../motion/tokens';

const BACKUP_DAYS = 30;

export default function Home() {
  const sheets = useSheets();
  const go = useGo();
  const level = useMotionLevel();
  const [settings] = useSettings();
  const data = useLiveQuery(async () => {
    const [cameras, rolls, stocks, visits, labs] = await Promise.all([
      db.cameras.filter((c) => !c.retired).toArray(), db.rolls.toArray(), db.stocks.toArray(), db.labVisits.toArray(), db.labs.toArray(),
    ]);
    return { cameras, rolls, stocks, visits, labs };
  }, []);
  if (!data) return <div className="page" />;
  const { cameras, rolls, stocks, visits, labs } = data;
  const stockOf = (id: string) => stocks.find((s) => s.id === id);
  const now = new Date();

  const inStock = rolls.filter((r) => r.status === 'stock');
  const loaded = rolls.filter((r) => r.status === 'loaded');
  const shot = rolls.filter((r) => r.status === 'shot');
  const atLab = rolls.filter((r) => r.status === 'at-lab');
  const expiring = inStock
    .filter((r) => !r.keepSealed && ['expired', 'soon'].includes(expiryState(r.expiry, now, settings.expiryWarnMonths)))
    .sort((a, b) => (a.expiry ?? '').localeCompare(b.expiry ?? ''));
  const activeVisits = visits.filter((v) => !v.backAt).sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  const first = rolls.length ? rolls.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), rolls[0].createdAt) : undefined;
  const lastBackup = settings.lastBackupAt ?? first;
  const backupDue = rolls.length > 0 && !!lastBackup && daysBetween(lastBackup, now) >= BACKUP_DAYS;

  if (!rolls.length && !cameras.length) {
    return (
      <div className="page">
        <PageHeader title="胶卷柜" sub="你的胶卷从这里开始" />
        <Empty
          title="还没有胶卷"
          text="先把手边的胶卷入库，再添加一台相机，就可以开始记录每一卷的去向。"
          action={
            <div className="stack">
              <button className="btn primary" onClick={() => sheets.openInStock()}>入库第一卷</button>
              <button className="btn ghost" onClick={() => sheets.openCamera()}>先添加相机</button>
            </div>
          }
        />
      </div>
    );
  }

  const list = (i: number) =>
    level === 'full' ? { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING.soft, delay: 0.04 * i } } : {};

  return (
    <div className="page">
      <PageHeader
        title="胶卷柜"
        sub={`${now.getMonth() + 1} 月 ${now.getDate()} 日 · 库存 ${inStock.length} 卷`}
        right={<button className="btn small primary" onClick={() => sheets.openInStock()}>＋ 入库</button>}
      />

      {backupDue && (
        <motion.div className="banner" {...list(0)}>
          <span>已经 {daysBetween(lastBackup!, now)} 天没有备份了，数据只存在这台设备上。</span>
          <Link to="/me/backup" className="btn small">去备份</Link>
        </motion.div>
      )}

      <motion.section className="section" {...list(1)}>
        <h2>在机 <small>{loaded.length}/{cameras.length}</small></h2>
        {cameras.length === 0 && (
          <div className="card soft-note">还没有相机。<button className="link" onClick={() => sheets.openCamera()}>添加相机</button></div>
        )}
        <div className="cam-cards">
          {cameras.map((c) => {
            const r = loaded.find((x) => x.cameraId === c.id);
            const s = r ? stockOf(r.stockId) : undefined;
            return (
              <div key={c.id} className={`card cam-card ${r ? 'has' : 'empty'}`}>
                <div className="cam-head">
                  <strong>{c.name}</strong>
                  <span className="mono muted">{FORMAT_LABEL[c.format]}</span>
                </div>
                {r && s ? (
                  <button
                    className="cam-body"
                    onClick={(e) => go(`/roll/${r.id}`, e.currentTarget.querySelector<HTMLElement>('.canister') ?? undefined)}
                  >
                    <Canister stock={s} size={34} />
                    <div>
                      <div className="roll-title">{s.name}</div>
                      <div className="muted small">在机 {daysBetween(r.loadedAt ?? r.updatedAt, now)} 天 · ISO {r.shotIso ?? s.iso}</div>
                    </div>
                  </button>
                ) : (
                  <div className="cam-body idle"><span className="muted">空着</span></div>
                )}
                {r ? (
                  <button className="btn small" onClick={() => sheets.openUnload(r.id)}>卸卷</button>
                ) : (
                  <button className="btn small primary" onClick={() => sheets.openLoad({ cameraId: c.id })}>上卷</button>
                )}
              </div>
            );
          })}
        </div>
      </motion.section>

      {shot.length > 0 && (
        <motion.section className="section" {...list(2)}>
          <h2>待冲 <small>{shot.length} 卷</small></h2>
          <div className="card row-card">
            <div className="stack-canisters">
              {shot.slice(0, 4).map((r) => <Canister key={r.id} stock={stockOf(r.stockId)} size={26} />)}
            </div>
            <div className="grow muted">拍完的胶卷攒一攒，一起送冲</div>
            <button className="btn small primary" onClick={() => sheets.openLab(shot.map((r) => r.id))}>送冲</button>
          </div>
        </motion.section>
      )}

      {activeVisits.length > 0 && (
        <motion.section className="section" {...list(3)}>
          <h2>在冲 <small>{atLab.length} 卷</small></h2>
          {activeVisits.map((v) => {
            const vr = atLab.filter((r) => r.labVisitId === v.id);
            const lab = labs.find((l) => l.id === v.labId);
            const days = daysBetween(v.sentAt, now);
            const late = v.expectedAt && new Date(v.expectedAt) < now;
            return (
              <div key={v.id} className="card row-card">
                <div className="stack-canisters">
                  {vr.slice(0, 3).map((r) => <Canister key={r.id} stock={stockOf(r.stockId)} size={24} />)}
                </div>
                <div className="grow">
                  <strong>{lab?.name ?? '冲洗店'}</strong>
                  <div className={`small ${late ? 'txt-warn' : 'muted'}`}>
                    {vr.length} 卷 · 已等 {days} 天{v.expectedAt ? ` · 预计 ${v.expectedAt.slice(5).replace('-', '/')}` : ''}
                  </div>
                </div>
                <button className="btn small primary" onClick={() => sheets.quickReturn(vr.map((r) => r.id))}>取回</button>
              </div>
            );
          })}
        </motion.section>
      )}

      {expiring.length > 0 && (
        <motion.section className="section" {...list(4)}>
          <h2>快过期 <small>{expiring.length} 卷</small></h2>
          <div className="list">
            {expiring.slice(0, 5).map((r) => (
              <RollCard key={r.id} roll={r} stock={stockOf(r.stockId)} warnMonths={settings.expiryWarnMonths} />
            ))}
          </div>
          {expiring.length > 5 && <Link to="/stock" className="link">在库存里查看全部 {expiring.length} 卷 →</Link>}
        </motion.section>
      )}

      {!expiring.length && !shot.length && !activeVisits.length && loaded.length === 0 && (
        <div className="muted center pad">一切安好。去拍点什么吧。</div>
      )}
    </div>
  );
}
