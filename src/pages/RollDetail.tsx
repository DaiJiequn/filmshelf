import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Canister } from '../components/Canister';
import { useConfirm } from '../components/Confirm';
import { PageHeader } from '../components/PageHeader';
import { useSheets } from '../components/SheetHost';
import { Empty, Stars } from '../components/ui';
import { deleteRoll, updateRoll } from '../db/actions';
import { db } from '../db/schema';
import { expiryState, expiryText } from '../domain/expiry';
import { PRIMARY_ACTION_LABEL, STATUS_LABEL, STATUS_ORDER } from '../domain/roll-state';
import { fmtDate, fmtMoney, FORMAT_LABEL, useSettings } from '../lib/hooks';
import { SPRING, useMotionLevel } from '../motion/tokens';
import { useToast } from '../components/Toast';

export default function RollDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const sheets = useSheets();
  const toast = useToast();
  const level = useMotionLevel();
  const { confirm, node } = useConfirm();
  const [settings] = useSettings();

  const data = useLiveQuery(async () => {
    const roll = await db.rolls.get(id);
    if (!roll) return { roll: undefined };
    const [stock, camera, visit, location] = await Promise.all([
      db.stocks.get(roll.stockId),
      roll.cameraId ? db.cameras.get(roll.cameraId) : undefined,
      roll.labVisitId ? db.labVisits.get(roll.labVisitId) : undefined,
      roll.locationId ? db.locations.get(roll.locationId) : undefined,
    ]);
    const lab = visit ? await db.labs.get(visit.labId) : undefined;
    return { roll, stock, camera, visit, lab, location };
  }, [id]);

  const [note, setNote] = useState('');
  useEffect(() => { setNote(data?.roll?.note ?? ''); }, [data?.roll?.id, data?.roll?.note]);

  if (!data) return <div className="page" />;
  const { roll, stock, camera, visit, lab, location } = data;
  if (!roll) {
    return (
      <div className="page">
        <PageHeader title="找不到这卷" back />
        <Empty title="这卷胶卷不存在" text="它可能已被删除。" />
      </div>
    );
  }
  const now = new Date();
  const st = roll.status === 'stock' ? expiryState(roll.expiry, now, settings.expiryWarnMonths) : 'none';
  const expired = st === 'expired';
  const action = PRIMARY_ACTION_LABEL[roll.status];

  const runPrimary = () => {
    switch (roll.status) {
      case 'stock': return roll.keepSealed ? toast.show('这卷是收藏，先取消封存才能上卷') : sheets.openLoad({ rollId: roll.id });
      case 'loaded': return sheets.openUnload(roll.id);
      case 'shot': return sheets.openLab([roll.id]);
      case 'at-lab': return void sheets.quickReturn([roll.id]);
      case 'back': return sheets.openArchive(roll.id);
      default: return undefined;
    }
  };

  const reached = new Map(roll.history.map((h) => [h.status, h.at]));
  const curIdx = STATUS_ORDER.indexOf(roll.status);

  return (
    <div className="page grain detail">
      <PageHeader title={stock ? stock.name : '胶卷'} sub={stock ? `${stock.brand} · ISO ${roll.shotIso ?? stock.iso} · ${FORMAT_LABEL[roll.format]}` : undefined} back />

      <div className="hero">
        <div className="hero-glow" />
        <Canister
          stock={stock}
          size={92}
          expired={expired}
          sealed={roll.keepSealed && roll.status === 'stock'}
          style={{ viewTransitionName: 'shared' } as React.CSSProperties}
        />
        {expired && (
          <motion.div
            className="stamp"
            initial={level === 'full' ? { scale: 2.2, opacity: 0, rotate: -24 } : { opacity: 0 }}
            animate={{ scale: 1, opacity: 1, rotate: -14 }}
            transition={level === 'full' ? { ...SPRING.snappy, delay: 0.25 } : { duration: 0.15 }}
          >
            EXPIRED
          </motion.div>
        )}
        <div className="hero-status">
          <span className={`status-pill s-${roll.status}`}>{STATUS_LABEL[roll.status]}</span>
          {roll.keepSealed && roll.status === 'stock' && <span className="badge keep">收藏封存</span>}
        </div>
      </div>

      <ol className="timeline" aria-label="状态时间线">
        {STATUS_ORDER.map((s, i) => {
          const at = reached.get(s);
          const state = i < curIdx ? 'done' : i === curIdx ? 'now' : 'todo';
          return (
            <motion.li
              key={s}
              className={`tl ${state}`}
              initial={level === 'full' ? { opacity: 0, x: -10 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...SPRING.soft, delay: 0.05 * i }}
            >
              <span className="tl-dot" />
              <span className="tl-label">{STATUS_LABEL[s]}</span>
              <span className="tl-date mono">{at ? fmtDate(at).slice(5) : ''}</span>
            </motion.li>
          );
        })}
      </ol>

      {action && (
        <button className="btn primary block big" onClick={runPrimary}>{action}</button>
      )}

      <section className="kv">
        {roll.status === 'stock' && <Row k="有效期" v={roll.expiry ? `${roll.expiry} · ${expiryText(roll.expiry, now)}` : '无'} tone={st === 'expired' ? 'danger' : st === 'soon' ? 'warn' : undefined} />}
        <Row k="价格" v={fmtMoney(roll.price, settings.currency)} />
        <Row k="购买" v={[fmtDate(roll.boughtAt) !== '—' ? fmtDate(roll.boughtAt) : '', roll.boughtFrom].filter(Boolean).join(' · ') || '—'} />
        {location && <Row k="存放" v={location.name} />}
        {roll.batchNo && <Row k="批号" v={roll.batchNo} />}
        {camera && <Row k="相机" v={camera.name} />}
        {roll.loadedAt && <Row k="上卷" v={fmtDate(roll.loadedAt)} />}
        {roll.framesShot !== undefined && <Row k="张数" v={`${roll.framesShot} 张`} />}
        {lab && <Row k="冲洗店" v={`${lab.name}${visit?.cost !== undefined ? ` · ${fmtMoney(visit.cost, settings.currency)}` : ''}`} />}
        {visit?.requests && <Row k="冲扫要求" v={visit.requests} />}
      </section>

      {roll.status === 'archived' && (
        <section className="section">
          <h2>评分</h2>
          <Stars value={roll.rating ?? 0} onChange={(n) => updateRoll(roll.id, { rating: n || undefined })} />
        </section>
      )}

      <section className="section">
        <h2>笔记</h2>
        <textarea
          className="input"
          rows={3}
          value={note}
          placeholder="拍摄心得、冲洗效果…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (roll.note ?? '') && updateRoll(roll.id, { note: note || undefined })}
        />
      </section>

      <div className="detail-tools">
        {roll.status === 'stock' && (
          <button className="btn ghost" onClick={() => updateRoll(roll.id, { keepSealed: !roll.keepSealed })}>
            {roll.keepSealed ? '取消封存' : '标为收藏'}
          </button>
        )}
        <button
          className="btn ghost danger-text"
          onClick={async () => {
            if (await confirm('删除这卷？', '删除后无法恢复（备份文件里还在的话可以导入找回）。', '删除', true)) {
              await deleteRoll(roll.id);
              navigate(-1);
            }
          }}
        >
          删除
        </button>
      </div>
      {node}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className="kv-row">
      <span className="muted">{k}</span>
      <span className={tone === 'danger' ? 'txt-danger' : tone === 'warn' ? 'txt-warn' : ''}>{v}</span>
    </div>
  );
}
