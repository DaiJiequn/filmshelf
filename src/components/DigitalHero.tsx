import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { Frame, Roll } from '../db/schema';
import { SPRING, useMotionLevel } from '../motion/tokens';
import { FilmProgress } from './FilmProgress';
import { CountUp } from './NumberRoll';
import { Thumb } from '../pages/Scans';
import { digitState, isDeveloped } from '../domain/digital';


/** 数字底片总览：已数字化进度、扫描件张数、待扫描卷数，以及最近扫描的几张 */
export function DigitalHero({ rolls, frames, strip = false, onPending }: { rolls: Roll[]; frames: Frame[]; strip?: boolean; onPending?: () => void }) {
  const level = useMotionLevel();
  const counts = new Map<string, number>();
  for (const f of frames) counts.set(f.rollId, (counts.get(f.rollId) ?? 0) + 1);
  const back = rolls.filter((r) => isDeveloped(r, counts.get(r.id) ?? 0));
  // 进度只算扫描件已经入库的卷；只登记了「扫过」但没导入的，单独提示
  const done = back.filter((r) => counts.has(r.id)).length;
  const external = back.filter((r) => digitState(r, counts.get(r.id) ?? 0) === 'external').length;
  const pending = back.length - done;
  const ratio = back.length ? done / back.length : 0;
  const recent = strip ? [...frames].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 9) : [];
  if (!back.length && !frames.length) return null;

  return (
    <motion.section
      className="dhero"
      initial={level === 'full' ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.soft}
      aria-label="数字底片"
    >
      <div className="dhero-top">
        <div>
          <div className="dhero-kicker">数字底片</div>
          <div className="dhero-big"><CountUp value={frames.length} /><span> 张扫描件</span></div>
        </div>
        <div className="dhero-ring" aria-hidden>
          <svg viewBox="0 0 36 36" width="64" height="64">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="3.5" />
            <motion.circle
              cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round"
              transform="rotate(-90 18 18)" pathLength={1} strokeDasharray="1 1"
              initial={{ strokeDashoffset: 1 }} animate={{ strokeDashoffset: 1 - ratio }} transition={{ duration: level === 'off' ? 0 : 0.9, ease: [0.2, 0, 0, 1] }}
            />
          </svg>
          <span className="dhero-pct">{Math.round(ratio * 100)}%</span>
        </div>
      </div>
      <FilmProgress value={ratio} />
      <div className="dhero-meta">
        <span>已入库 <b><CountUp value={done} /></b> / {back.length} 卷{external > 0 ? ` · ${external} 卷扫过未导入` : ''}</span>
        {pending > 0 ? (onPending
          ? <button className="dhero-link" onClick={onPending}>待导入 {pending} 卷 ›</button>
          : <Link to="/" className="dhero-link">待导入 {pending} 卷 ›</Link>) : back.length > 0 ? <span className="dhero-ok">全部数字化 ✓</span> : null}
      </div>
      {strip && recent.length > 0 && (
        <div className="dhero-strip" aria-label="最近扫描">
          {recent.map((f) => (
            <Link key={f.id} to={`/roll/${f.rollId}/scans`} className="dhero-thumb" aria-label="查看这卷的扫描件"><Thumb photoId={f.thumbId} /></Link>
          ))}
        </div>
      )}
    </motion.section>
  );
}
