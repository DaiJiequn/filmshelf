import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Canister } from '../components/Canister';
import { NumberRoll } from '../components/NumberRoll';
import { PageHeader } from '../components/PageHeader';
import { RollCard } from '../components/RollCard';
import { useSheets } from '../components/SheetHost';
import { SwipeAction } from '../components/SwipeAction';
import { Chips, Empty } from '../components/ui';
import { db, type FilmFormat, type RollStatus } from '../db/schema';
import { expiryState } from '../domain/expiry';
import { STATUS_LABEL } from '../domain/roll-state';
import { FORMAT_LABEL, useSettings } from '../lib/hooks';
import { scaled, SPRING, useMotionLevel } from '../motion/tokens';

type StatusFilter = RollStatus | 'all';
type Sort = 'expiry' | 'name' | 'count';

export default function Stock() {
  const sheets = useSheets();
  const level = useMotionLevel();
  const [settings] = useSettings();
  const [status, setStatus] = useState<StatusFilter>('stock');
  const [format, setFormat] = useState<FilmFormat | 'all'>('all');
  const [sort, setSort] = useState<Sort>('expiry');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const data = useLiveQuery(async () => {
    const [rolls, stocks, cameras] = await Promise.all([db.rolls.toArray(), db.stocks.toArray(), db.cameras.toArray()]);
    return { rolls, stocks, cameras };
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const filtered = data.rolls.filter((r) => (status === 'all' || r.status === status) && (format === 'all' || r.format === format));
    const m = new Map<string, typeof filtered>();
    for (const r of filtered) m.set(r.stockId, [...(m.get(r.stockId) ?? []), r]);
    const out = [...m.entries()]
      .map(([sid, rs]) => {
        const stock = data.stocks.find((s) => s.id === sid)!;
        const sorted = rs.sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999'));
        const worst = sorted.find((r) => r.expiry)?.expiry;
        return { stock, rolls: sorted, worst, state: expiryState(worst, now, settings.expiryWarnMonths) };
      })
      .filter((g) => g.stock);
    out.sort((a, b) =>
      sort === 'count' ? b.rolls.length - a.rolls.length
      : sort === 'name' ? `${a.stock.brand}${a.stock.name}`.localeCompare(`${b.stock.brand}${b.stock.name}`)
      : (a.worst ?? '9999').localeCompare(b.worst ?? '9999'));
    return out;
  }, [data, status, format, sort, settings.expiryWarnMonths]);

  if (!data) return <div className="page" />;
  const total = groups.reduce((n, g) => n + g.rolls.length, 0);

  return (
    <div className="page">
      <PageHeader title="库存" sub={`${STATUS_LABEL[status as RollStatus] ?? '全部'} · ${total} 卷`} right={<div className="row-btns"><Link to="/catalog" className="btn small">图鉴</Link><button className="btn small primary" onClick={() => sheets.openInStock()}>＋ 入库</button></div>} />
      <div className="filters">
        <Chips<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[{ value: 'stock', label: '库存' }, { value: 'loaded', label: '在机' }, { value: 'shot', label: '待冲' }, { value: 'at-lab', label: '在冲' }, { value: 'back', label: '已取回' }, { value: 'archived', label: '归档' }, { value: 'all', label: '全部' }]}
        />
        <div className="filter-row">
          <Chips<FilmFormat | 'all'>
            value={format}
            onChange={setFormat}
            options={[{ value: 'all', label: '全画幅' }, ...(['135', '120', '4x5', '110'] as FilmFormat[]).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))]}
          />
          <select className="input select-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="排序">
            <option value="expiry">按到期</option>
            <option value="name">按名称</option>
            <option value="count">按数量</option>
          </select>
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty
          title={status === 'stock' ? '库存是空的' : '这里还没有胶卷'}
          text={status === 'stock' ? '入库几卷胶卷，它们会按品种整齐地排在这里。' : '换个状态看看，或者先入库。'}
          action={<button className="btn primary" onClick={() => sheets.openInStock()}>入库</button>}
        />
      ) : (
        <div className="list">
          {groups.map((g) => {
            const expanded = open[g.stock.id] ?? groups.length <= 3;
            return (
              <motion.div key={g.stock.id} layout={level === 'full' ? 'position' : false} transition={SPRING.snappy} className="group">
                <button className="group-head" onClick={() => setOpen({ ...open, [g.stock.id]: !expanded })} aria-expanded={expanded}>
                  <Canister stock={g.stock} size={32} expired={g.state === 'expired' && status === 'stock'} />
                  <div className="grow">
                    <div className="roll-title">{g.stock.brand} {g.stock.name}</div>
                    <div className="muted small">
                      ISO {g.stock.iso}
                      {g.worst && <span className={g.state === 'expired' ? 'txt-danger' : g.state === 'soon' ? 'txt-warn' : ''}> · 最早 {g.worst}</span>}
                    </div>
                  </div>
                  <span className="count"><NumberRoll value={g.rolls.length} /></span>
                  <span className={`chev ${expanded ? 'open' : ''}`} aria-hidden="true">›</span>
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      className="group-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: scaled(level, 0.24), ease: [0.2, 0, 0, 1] }}
                    >
                      <div className="list inner">
                        {g.rolls.map((r) => (
                          <SwipeAction
                            key={r.id}
                            actionLabel="上卷"
                            disabled={r.status !== 'stock' || r.keepSealed}
                            onAction={() => sheets.openLoad({ rollId: r.id })}
                          >
                            <RollCard
                              roll={r}
                              stock={g.stock}
                              warnMonths={settings.expiryWarnMonths}
                              showStatus={status === 'all'}
                              cameraName={data.cameras.find((c) => c.id === r.cameraId)?.name}
                            />
                          </SwipeAction>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
