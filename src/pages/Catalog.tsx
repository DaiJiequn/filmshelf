import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Canister } from '../components/Canister';
import { NumberRoll } from '../components/NumberRoll';
import { PageHeader } from '../components/PageHeader';
import { useSheets } from '../components/SheetHost';
import { Chips } from '../components/ui';
import { db } from '../db/schema';
import { useGo } from '../lib/nav';
import { SPRING, useMotionLevel } from '../motion/tokens';

type Show = 'all' | 'lit' | 'unlit';

export default function Catalog() {
  const sheets = useSheets();
  const go = useGo();
  const level = useMotionLevel();
  const [brand, setBrand] = useState('all');
  const [show, setShow] = useState<Show>('all');

  const data = useLiveQuery(async () => {
    const [stocks, archived, all] = await Promise.all([
      db.stocks.toArray(),
      db.rolls.where('status').equals('archived').toArray(),
      db.rolls.toArray(),
    ]);
    const lit = new Map<string, number>();
    for (const r of archived) lit.set(r.stockId, (lit.get(r.stockId) ?? 0) + 1);
    const owned = new Set(all.map((r) => r.stockId));
    return { stocks, lit, owned };
  }, []);

  const brands = useMemo(() => {
    if (!data) return [];
    const c = new Map<string, number>();
    for (const s of data.stocks) c.set(s.brand, (c.get(s.brand) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  }, [data]);

  if (!data) return <div className="page" />;
  const { stocks, lit, owned } = data;
  const litCount = stocks.filter((s) => lit.has(s.id)).length;
  const shown = stocks
    .filter((s) => (brand === 'all' || s.brand === brand) && (show === 'all' || (show === 'lit') === lit.has(s.id)))
    .sort((a, b) => Number(lit.has(b.id)) - Number(lit.has(a.id)) || a.brand.localeCompare(b.brand) || a.iso - b.iso);

  return (
    <div className="page grain">
      <PageHeader
        title="图鉴"
        sub="拍完并归档的品种会被点亮"
        right={<button className="btn small" onClick={() => sheets.openStockForm(undefined, (id) => go(`/catalog/${id}`))}>＋ 品种</button>}
      />
      <div className="progress-card">
        <div className="progress-num">已点亮 <strong><NumberRoll value={litCount} /></strong> / {stocks.length}</div>
        <div className="progress-track">
          <motion.div
            className="progress-fill"
            initial={false}
            animate={{ width: `${stocks.length ? (litCount / stocks.length) * 100 : 0}%` }}
            transition={level === 'off' ? { duration: 0 } : SPRING.soft}
          />
        </div>
      </div>
      <div className="filters">
        <Chips<string> value={brand} onChange={setBrand} options={[{ value: 'all', label: '全部品牌' }, ...brands.map((b) => ({ value: b, label: b }))]} />
        <Chips<Show> value={show} onChange={setShow} options={[{ value: 'all', label: '全部' }, { value: 'lit', label: '已点亮' }, { value: 'unlit', label: '未点亮' }]} />
      </div>
      <div className="wall">
        {shown.map((s, i) => {
          const isLit = lit.has(s.id);
          return (
            <motion.button
              key={s.id}
              layout={level === 'full' ? 'position' : false}
              initial={level === 'full' && i < 24 ? { opacity: 0, y: 12 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING.soft, delay: i < 24 ? i * 0.02 : 0 }}
              className={`tile ${isLit ? 'lit' : 'unlit'}`}
              onClick={(e) => go(`/catalog/${s.id}`, e.currentTarget.querySelector<HTMLElement>('.canister') ?? undefined)}
            >
              <Canister stock={s} size={40} unlit={!isLit} />
              <span className="tile-name">{isLit ? s.name : owned.has(s.id) ? s.name : '？'}</span>
              <span className="tile-sub">{isLit ? `${s.brand} · ${lit.get(s.id)} 卷` : s.brand}</span>
              {s.discontinued && <span className="tile-badge">停产</span>}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
