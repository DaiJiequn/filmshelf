import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Canister } from '../components/Canister';
import { DigitalHero } from '../components/DigitalHero';
import { PageHeader } from '../components/PageHeader';
import { COND_LABEL, SCAN_LABEL, useSheets } from '../components/SheetHost';
import { Chips, Empty } from '../components/ui';
import { db } from '../db/schema';
import { fmtDate, FORMAT_LABEL } from '../lib/hooks';
import { shotDate } from '../domain/digital';
import { useGo } from '../lib/nav';
import { SPRING, useMotionLevel } from '../motion/tokens';

type Filter = 'all' | 'unscanned' | 'noplace' | 'bad';

/** 底片柜：所有冲洗完的卷，按存放位置分组，能一眼看出哪些还没扫描、没记位置、状态不好 */
export default function Negatives() {
  const sheets = useSheets();
  const go = useGo();
  const level = useMotionLevel();
  const [filter, setFilter] = useState<Filter>('all');
  const data = useLiveQuery(async () => ({
    rolls: await db.rolls.filter((r) => r.status === 'back' || r.status === 'archived').toArray(),
    frames: await db.frames.toArray(),
    stocks: await db.stocks.toArray(),
  }), []);

  let order = 0;
  const groups = useMemo(() => {
    if (!data) return [];
    const list = data.rolls.filter((r) => {
      const n = r.neg;
      if (filter === 'unscanned') return !data.frames.some((f) => f.rollId === r.id);
      if (filter === 'noplace') return !n?.place;
      if (filter === 'bad') return !!n?.condition && n.condition !== 'good';
      return true;
    });
    const m = new Map<string, typeof list>();
    for (const r of list) {
      const k = r.neg?.place || '未记录位置';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] === '未记录位置' ? 1 : b[0] === '未记录位置' ? -1 : a[0].localeCompare(b[0], 'zh')))
      .map(([place, rolls]) => ({ place, rolls: rolls.sort((a, b) => (a.neg?.slot ?? '').localeCompare(b.neg?.slot ?? '', 'zh', { numeric: true }) || (b.loadedAt ?? '').localeCompare(a.loadedAt ?? '')) }));
  }, [data, filter]);

  if (!data) return <div className="page" />;
  const total = data.rolls.length;
  const frameCount = new Map<string, number>();
  for (const f of data.frames) frameCount.set(f.rollId, (frameCount.get(f.rollId) ?? 0) + 1);
  const scanned = data.rolls.filter((r) => frameCount.has(r.id)).length;

  return (
    <div className="page">
      <PageHeader title="底片柜" sub={`${total} 卷底片 · 扫描件已入库 ${scanned} 卷`} right={<button className="btn small" onClick={() => sheets.openPast()}>补录旧卷</button>} />
      <DigitalHero rolls={data.rolls} frames={data.frames} />
      <Chips<Filter>
        value={filter}
        onChange={setFilter}
        options={[{ value: 'all', label: '全部' }, { value: 'unscanned', label: '待导入' }, { value: 'noplace', label: '没记位置' }, { value: 'bad', label: '状态不好' }]}
      />
      {groups.length === 0 ? (
        <Empty title={total ? '没有符合条件的底片' : '还没有冲洗完的底片'} text={total ? '换个筛选看看。' : '胶卷取回后，在卷详情里记录底片放在哪里；已有的旧胶卷可以先补录。'} />
      ) : (
        groups.map((g) => (
          <section key={g.place} className="section">
            <h2>{g.place} <small>{g.rolls.length} 卷</small></h2>
            <div className="list">
              {g.rolls.map((r) => {
                const s = data.stocks.find((x) => x.id === r.stockId);
                const sc = r.neg?.scanned ?? 'none';
                return (
                  <motion.button
                    key={r.id} className="card row-card" onClick={() => go(`/roll/${r.id}`)}
                    layout={level === 'full' ? 'position' : false}
                    initial={level === 'full' ? { opacity: 0, y: 12 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING.soft, delay: level === 'full' ? Math.min(order++, 14) * 0.035 : 0 }}
                  >
                    <Canister stock={s} size={28} />
                    <div className="grow">
                      <div className="roll-title">{s ? `${s.brand} ${s.name}` : '未知品种'}</div>
                      <div className="roll-sub">
                        <span className="mono">{FORMAT_LABEL[r.format]}</span>
                        <span>{shotDate(r) ? fmtDate(shotDate(r)).slice(0, 7) : '日期未知'}</span>
                        {r.neg?.slot && <span>{r.neg.slot}</span>}
                      </div>
                    </div>
                    {(frameCount.get(r.id) ?? 0) > 0
                      ? <span className="badge keep">已入库 · {frameCount.get(r.id)} 张</span>
                      : <span className="badge">{sc === 'none' ? '未扫描' : `${SCAN_LABEL[sc]} · 未导入`}</span>}
                    {r.neg?.condition && r.neg.condition !== 'good' && <span className="badge txt-warn">{COND_LABEL[r.neg.condition]}</span>}
                  </motion.button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
