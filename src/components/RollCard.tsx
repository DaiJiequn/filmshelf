import { motion } from 'motion/react';
import type { Roll, FilmStock } from '../db/schema';
import { Canister } from './Canister';
import { expiryState, expiryText } from '../domain/expiry';
import { STATUS_LABEL } from '../domain/roll-state';
import { FORMAT_LABEL } from '../lib/hooks';
import { useMotionLevel, SPRING } from '../motion/tokens';
import { useGo } from '../lib/nav';

interface Props {
  roll: Roll;
  stock?: FilmStock;
  warnMonths: number;
  extra?: React.ReactNode;
  showStatus?: boolean;
  cameraName?: string;
}

/** 卷卡片：点击以视图转场（共享罐体）进入详情 */
export function RollCard({ roll, stock, warnMonths, extra, showStatus, cameraName }: Props) {
  const go = useGo();
  const level = useMotionLevel();
  const st = roll.status === 'stock' ? expiryState(roll.expiry, new Date(), warnMonths) : 'none';
  const expired = st === 'expired';
  return (
    <motion.button
      layout={level === 'full' ? 'position' : false}
      transition={SPRING.snappy}
      className={`card roll-card ${expired ? 'is-expired' : ''}`}
      onClick={(e) => {
        const el = e.currentTarget.querySelector<HTMLElement>('.canister');
        go(`/roll/${roll.id}`, el ?? undefined);
      }}
    >
      <Canister stock={stock} size={34} expired={expired} sealed={roll.keepSealed && roll.status === 'stock'} />
      <div className="roll-main">
        <div className="roll-title">
          {stock ? `${stock.brand} ${stock.name}` : '未知品种'}
          {roll.keepSealed && roll.status === 'stock' && <span className="badge keep">收藏</span>}
        </div>
        <div className="roll-sub">
          <span className="mono">{FORMAT_LABEL[roll.format]}</span>
          {roll.status === 'stock' ? (
            <span className={st === 'expired' ? 'txt-danger' : st === 'soon' ? 'txt-warn' : ''}>
              {roll.expiry ? `${roll.expiry} · ${expiryText(roll.expiry, new Date())}` : '无有效期'}
            </span>
          ) : (
            showStatus && <span>{STATUS_LABEL[roll.status]}</span>
          )}
          {cameraName && <span>{cameraName}</span>}
        </div>
      </div>
      {expired && <span className="stamp-mini">EXPIRED</span>}
      {extra}
    </motion.button>
  );
}
