import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  addPastRolls, addRolls, archiveRoll, loadRoll, returnFromLab, sendToLab, unloadRoll,
} from '../db/actions';
import { db, uid, type FilmFormat, type FilmStock, type FilmType, type Roll } from '../db/schema';
import { useRitual } from '../motion/signatures/Ritual';
import { FORMAT_LABEL, useSettings } from '../lib/hooks';
import { savePhoto, TYPE_LABEL } from '../lib/image';
import { BottomSheet } from './BottomSheet';
import { Canister } from './Canister';
import { useToast } from './Toast';
import { Chips, Field, PhotoInput, Segmented, Stars, Stepper, Switch } from './ui';

interface SheetsApi {
  openInStock: (stockId?: string) => void;
  openLoad: (opts: { rollId?: string; cameraId?: string }) => void;
  openUnload: (rollId: string) => void;
  openLab: (rollIds?: string[]) => void;
  openArchive: (rollId: string) => void;
  openPast: (stockId?: string) => void;
  openStockForm: (stockId?: string, onDone?: (id: string) => void) => void;
  openCamera: (id?: string, onDone?: (id: string) => void) => void;
  quickReturn: (rollIds: string[]) => Promise<void>;
}

const Ctx = createContext<SheetsApi | null>(null);
export const useSheets = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('SheetsProvider missing');
  return c;
};

type Main =
  | { kind: 'instock'; stockId?: string }
  | { kind: 'load'; rollId?: string; cameraId?: string }
  | { kind: 'unload'; rollId: string }
  | { kind: 'lab'; rollIds: string[] }
  | { kind: 'archive'; rollId: string }
  | { kind: 'past'; stockId?: string }
  | null;

type Sub =
  | { kind: 'stock'; stockId?: string; onDone?: (id: string) => void }
  | { kind: 'camera'; cameraId?: string; onDone?: (id: string) => void }
  | null;

export function SheetsProvider({ children }: { children: React.ReactNode }) {
  const [main, setMain] = useState<Main>(null);
  const [sub, setSub] = useState<Sub>(null);
  const toast = useToast();
  const ritual = useRitual();

  const quickReturn = useCallback(
    async (rollIds: string[]) => {
      try {
        const rolls = (await db.rolls.bulkGet(rollIds)).filter((r): r is Roll => !!r);
        const stock = rolls[0] ? await db.stocks.get(rolls[0].stockId) : undefined;
        const { undo } = await returnFromLab(rollIds);
        await ritual.play('back', { count: rollIds.length, stock });
        toast.show(`已取回 ${rollIds.length} 卷`, { undo });
      } catch (e) {
        toast.show((e as Error).message, { tone: 'error' });
      }
    },
    [ritual, toast],
  );

  const api = useMemo<SheetsApi>(
    () => ({
      openInStock: (stockId) => setMain({ kind: 'instock', stockId }),
      openLoad: (o) => setMain({ kind: 'load', ...o }),
      openUnload: (rollId) => setMain({ kind: 'unload', rollId }),
      openLab: (rollIds = []) => setMain({ kind: 'lab', rollIds }),
      openArchive: (rollId) => setMain({ kind: 'archive', rollId }),
      openPast: (stockId) => setMain({ kind: 'past', stockId }),
      openStockForm: (stockId, onDone) => setSub({ kind: 'stock', stockId, onDone }),
      openCamera: (cameraId, onDone) => setSub({ kind: 'camera', cameraId, onDone }),
      quickReturn,
    }),
    [quickReturn],
  );

  const closeMain = useCallback(() => setMain(null), []);
  const closeSub = useCallback(() => setSub(null), []);

  return (
    <Ctx.Provider value={api}>
      {children}
      <InStockSheet state={main?.kind === 'instock' ? main : null} onClose={closeMain} api={api} />
      <LoadSheet state={main?.kind === 'load' ? main : null} onClose={closeMain} api={api} />
      <UnloadSheet state={main?.kind === 'unload' ? main : null} onClose={closeMain} />
      <LabSheet state={main?.kind === 'lab' ? main : null} onClose={closeMain} />
      <PastSheet state={main?.kind === 'past' ? main : null} onClose={closeMain} api={api} />
      <ArchiveSheet state={main?.kind === 'archive' ? main : null} onClose={closeMain} />
      <StockFormSheet state={sub?.kind === 'stock' ? sub : null} onClose={closeSub} />
      <CameraFormSheet state={sub?.kind === 'camera' ? sub : null} onClose={closeSub} />
    </Ctx.Provider>
  );
}

const num = (s: string): number | undefined => {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/* ────────────────────────────── 入库 ────────────────────────────── */

function InStockSheet({ state, onClose, api }: { state: { stockId?: string } | null; onClose: () => void; api: SheetsApi }) {
  const open = !!state;
  const stocks = useLiveQuery(() => db.stocks.toArray(), []) ?? [];
  const locations = useLiveQuery(() => db.locations.orderBy('order').toArray(), []) ?? [];
  const toast = useToast();
  const ritual = useRitual();

  const [stockId, setStockId] = useState<string>();
  const [q, setQ] = useState('');
  const [format, setFormat] = useState<FilmFormat>('135');
  const [count, setCount] = useState(1);
  const [expiry, setExpiry] = useState('');
  const [price, setPrice] = useState('');
  const [boughtAt, setBoughtAt] = useState('');
  const [boughtFrom, setBoughtFrom] = useState('');
  const [locationId, setLocationId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [keepSealed, setKeepSealed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStockId(state?.stockId);
      setQ('');
      setCount(1);
      setExpiry('');
      setPrice('');
      setBoughtAt('');
      setBoughtFrom('');
      setBatchNo('');
      setKeepSealed(false);
      setLocationId('');
    }
  }, [open, state?.stockId]);

  const stock = stocks.find((s) => s.id === stockId);

  // 选中品种后，预填上次的价格 / 来源 / 画幅
  useEffect(() => {
    if (!stock) return;
    setFormat((f) => (stock.formats.includes(f) ? f : stock.formats[0]));
    let alive = true;
    db.rolls.where('stockId').equals(stock.id).toArray().then((rs) => {
      if (!alive || !rs.length) return;
      const last = rs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (last.price !== undefined) setPrice(String(last.price));
      if (last.boughtFrom) setBoughtFrom(last.boughtFrom);
      if (stock.formats.includes(last.format)) setFormat(last.format);
    });
    return () => { alive = false; };
  }, [stock]);

  useEffect(() => {
    if (open && !locationId && locations[0]) setLocationId(locations[0].id);
  }, [open, locations, locationId]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return [...stocks]
      .filter((s) => !k || `${s.brand} ${s.name}`.toLowerCase().includes(k) || String(s.iso) === k)
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.iso - b.iso || a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [stocks, q]);

  async function submit() {
    if (!stock) return;
    setBusy(true);
    try {
      const { ids, undo } = await addRolls({
        stockId: stock.id, format, count, expiry: expiry || undefined, batchNo: batchNo || undefined,
        price: num(price), boughtAt: boughtAt || undefined, boughtFrom: boughtFrom || undefined,
        locationId: locationId || undefined, keepSealed,
      });
      const total = await db.rolls.where('stockId').equals(stock.id).filter((r) => r.status === 'stock').count();
      onClose();
      await ritual.play('stockin', { stock, count: ids.length, total });
      toast.show(`已入库 ${ids.length} 卷 ${stock.name}`, { undo });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={stock ? '入库' : '选择品种'}
      footer={stock && (
        <button className="btn primary block" disabled={busy} onClick={submit}>
          入库 {count} 卷
        </button>
      )}
    >
      {!stock ? (
        <div className="picker">
          <input className="input" placeholder="搜索品牌 / 品种 / ISO" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="pick-list">
            {filtered.map((s) => (
              <li key={s.id}>
                <button className="pick-row" onClick={() => setStockId(s.id)}>
                  <Canister stock={s} size={26} />
                  <span className="pick-name">{s.brand} {s.name}</span>
                  <span className="pick-meta mono">{s.formats.map((f) => FORMAT_LABEL[f]).join(' / ')}</span>
                  {s.discontinued && <span className="badge">停产</span>}
                </button>
              </li>
            ))}
            {!filtered.length && <li className="muted pad">没有找到「{q}」</li>}
          </ul>
          <button className="btn ghost block" onClick={() => api.openStockForm(undefined, (id) => setStockId(id))}>
            找不到？新建品种
          </button>
        </div>
      ) : (
        <div className="form">
          <div className="selected-stock">
            <Canister stock={stock} size={40} />
            <div>
              <strong>{stock.brand} {stock.name}</strong>
              <div className="muted">ISO {stock.iso} · {TYPE_LABEL[stock.type]}</div>
            </div>
            <button className="btn small ghost" onClick={() => setStockId(undefined)}>更换</button>
          </div>
          {stock.formats.length > 1 && (
            <Field label="画幅">
              <Segmented value={format} onChange={setFormat} options={stock.formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))} ariaLabel="画幅" />
            </Field>
          )}
          <Field label="数量">
            <Stepper value={count} onChange={setCount} />
          </Field>
          <Field label="有效期（月）" hint="留空 = 无有效期">
            <input className="input" type="month" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
          <details className="more">
            <summary>更多信息（价格、来源、位置…）</summary>
            <Field label="单价">
              <input className="input" inputMode="decimal" placeholder="每卷价格" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="购买日期">
              <input className="input" type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
            </Field>
            <Field label="购买渠道">
              <input className="input" value={boughtFrom} onChange={(e) => setBoughtFrom(e.target.value)} placeholder="例如 Yodobashi / 淘宝" />
            </Field>
            {locations.length > 0 && (
              <Field label="存放位置">
                <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">未指定</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="批号">
              <input className="input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
            </Field>
          </details>
          <Switch checked={keepSealed} onChange={setKeepSealed} label="标为收藏（封存不拍）" />
        </div>
      )}
    </BottomSheet>
  );
}

/* ────────────────────────────── 上卷 ────────────────────────────── */

function LoadSheet({ state, onClose, api }: { state: { rollId?: string; cameraId?: string } | null; onClose: () => void; api: SheetsApi }) {
  const open = !!state;
  const toast = useToast();
  const ritual = useRitual();
  const cameras = useLiveQuery(() => db.cameras.filter((c) => !c.retired).toArray(), []) ?? [];
  const loadedByCamera = useLiveQuery(
    async () => new Set((await db.rolls.where('status').equals('loaded').toArray()).map((r) => r.cameraId!)),
    [],
  );
  const stocks = useLiveQuery(() => db.stocks.toArray(), []) ?? [];
  const stockRolls = useLiveQuery(
    () => db.rolls.where('status').equals('stock').filter((r) => !r.keepSealed).toArray(), [],
  ) ?? [];

  const [rollId, setRollId] = useState<string>();
  const [cameraId, setCameraId] = useState<string>();
  const [iso, setIso] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setRollId(state?.rollId);
      setCameraId(state?.cameraId);
      setIso('');
    }
  }, [open, state?.rollId, state?.cameraId]);

  const roll = useLiveQuery(() => (rollId ? db.rolls.get(rollId) : undefined), [rollId]);
  const stock = stocks.find((s) => s.id === roll?.stockId);
  const camera = cameras.find((c) => c.id === cameraId);

  // 没有指定卷：按品种列出，FEFO（先到期先用）
  const groups = useMemo(() => {
    const m = new Map<string, Roll[]>();
    for (const r of stockRolls) {
      if (camera && r.format !== camera.format) continue;
      m.set(r.stockId, [...(m.get(r.stockId) ?? []), r]);
    }
    return [...m.entries()].map(([sid, rs]) => ({
      stock: stocks.find((s) => s.id === sid),
      rolls: rs.sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999')),
    })).filter((g) => g.stock);
  }, [stockRolls, stocks, camera]);

  async function submit() {
    if (!roll || !stock || !cameraId || !camera) return;
    setBusy(true);
    try {
      const { undo, remaining } = await loadRoll(roll.id, { cameraId, shotIso: num(iso) });
      onClose();
      await ritual.play('load', { stock, cameraName: camera.name, remaining });
      toast.show(`已上卷到 ${camera.name}`, { undo });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const usable = cameras.filter((c) => !roll || c.format === roll.format);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={roll ? '上卷' : '选一卷'}
      footer={roll && (
        <button className="btn primary block" disabled={busy || !cameraId} onClick={submit}>
          {cameraId ? '上卷' : '先选相机'}
        </button>
      )}
    >
      {!roll ? (
        <div className="picker">
          {camera && <p className="muted">给 {camera.name}（{FORMAT_LABEL[camera.format]}）选一卷，先到期的排前面。</p>}
          <ul className="pick-list">
            {groups.map((g) => (
              <li key={g.stock!.id}>
                <button className="pick-row" onClick={() => setRollId(g.rolls[0].id)}>
                  <Canister stock={g.stock} size={26} />
                  <span className="pick-name">{g.stock!.brand} {g.stock!.name}</span>
                  <span className="pick-meta mono">{g.rolls.length} 卷</span>
                </button>
              </li>
            ))}
            {!groups.length && <li className="muted pad">没有可用的库存胶卷{camera ? `（${FORMAT_LABEL[camera.format]}）` : ''}。</li>}
          </ul>
        </div>
      ) : (
        <div className="form">
          <div className="selected-stock">
            <Canister stock={stock} size={40} />
            <div>
              <strong>{stock?.brand} {stock?.name}</strong>
              <div className="muted">{FORMAT_LABEL[roll.format]}{roll.expiry ? ` · ${roll.expiry} 到期` : ''}</div>
            </div>
          </div>
          <Field label="装进哪台相机">
            <div className="cam-grid">
              {usable.map((c) => {
                const busyCam = loadedByCamera?.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busyCam}
                    className={`cam-pick ${cameraId === c.id ? 'on' : ''}`}
                    onClick={() => setCameraId(c.id)}
                  >
                    <strong>{c.name}</strong>
                    <span>{busyCam ? '已有一卷在机' : FORMAT_LABEL[c.format]}</span>
                  </button>
                );
              })}
              <button type="button" className="cam-pick add" onClick={() => api.openCamera(undefined, (id) => setCameraId(id))}>
                ＋ 新增相机
              </button>
            </div>
          </Field>
          <Field label="曝光 ISO" hint={`默认 ${stock?.iso ?? ''}；增感/减感时改这里`}>
            <input className="input" inputMode="numeric" placeholder={String(stock?.iso ?? '')} value={iso} onChange={(e) => setIso(e.target.value)} />
          </Field>
        </div>
      )}
    </BottomSheet>
  );
}

/* ────────────────────────────── 卸卷 ────────────────────────────── */

function UnloadSheet({ state, onClose }: { state: { rollId: string } | null; onClose: () => void }) {
  const open = !!state;
  const toast = useToast();
  const ritual = useRitual();
  const roll = useLiveQuery(() => (state ? db.rolls.get(state.rollId) : undefined), [state?.rollId]);
  const stock = useLiveQuery(() => (roll ? db.stocks.get(roll.stockId) : undefined), [roll?.stockId]);
  const camera = useLiveQuery(() => (roll?.cameraId ? db.cameras.get(roll.cameraId) : undefined), [roll?.cameraId]);
  const [frames, setFrames] = useState('');
  useEffect(() => { if (open) setFrames(''); }, [open]);

  async function submit() {
    if (!roll) return;
    try {
      const { undo } = await unloadRoll(roll.id, num(frames));
      onClose();
      await ritual.play('unload', { stock, cameraName: camera?.name });
      toast.show('已卸卷，等待送冲', { undo });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    }
  }
  const presets = stock?.formats.includes('120') && roll?.format === '120' ? [12, 16] : [12, 24, 36];
  return (
    <BottomSheet open={open} onClose={onClose} title="卸卷" footer={<button className="btn primary block" onClick={submit}>确认卸卷</button>}>
      <div className="form">
        <div className="selected-stock">
          <Canister stock={stock} size={40} />
          <div>
            <strong>{stock?.brand} {stock?.name}</strong>
            <div className="muted">{camera?.name}</div>
          </div>
        </div>
        <Field label="拍了多少张（可选）">
          <input className="input" inputMode="numeric" value={frames} onChange={(e) => setFrames(e.target.value)} placeholder="例如 36" />
        </Field>
        <div className="chips">
          {presets.map((n) => <button key={n} className={`chip ${frames === String(n) ? 'on' : ''}`} onClick={() => setFrames(String(n))}>{n}</button>)}
        </div>
        <p className="muted small">中途卸卷（没拍完）将在后续版本支持。</p>
      </div>
    </BottomSheet>
  );
}

/* ────────────────────────────── 送冲 ────────────────────────────── */

function LabSheet({ state, onClose }: { state: { rollIds: string[] } | null; onClose: () => void }) {
  const open = !!state;
  const toast = useToast();
  const ritual = useRitual();
  const labs = useLiveQuery(() => db.labs.toArray(), []) ?? [];
  const shot = useLiveQuery(() => db.rolls.where('status').equals('shot').toArray(), []) ?? [];
  const stocks = useLiveQuery(() => db.stocks.toArray(), []) ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [labId, setLabId] = useState('');
  const [newLab, setNewLab] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [cost, setCost] = useState('');
  const [requests, setRequests] = useState('');

  useEffect(() => {
    if (open) {
      setPicked(state!.rollIds);
      setExpectedAt('');
      setCost('');
      setRequests('');
      setNewLab('');
    }
  }, [open, state]);
  useEffect(() => {
    if (open && !labId && labs[0]) setLabId(labs[0].id);
  }, [open, labs, labId]);

  async function submit() {
    try {
      let lid = labId;
      let labName = labs.find((l) => l.id === lid)?.name ?? '';
      if (!lid || newLab.trim()) {
        if (!newLab.trim()) throw new Error('请选择或填写冲洗店');
        lid = uid();
        labName = newLab.trim();
        await db.labs.add({ id: lid, name: labName });
        setLabId(lid);
      }
      const first = shot.find((r) => r.id === picked[0]);
      const { undo } = await sendToLab(picked, { labId: lid, expectedAt: expectedAt || undefined, cost: num(cost), requests });
      onClose();
      await ritual.play('lab', { stock: stocks.find((s) => s.id === first?.stockId), count: picked.length, labName });
      toast.show(`已送冲 ${picked.length} 卷 · ${labName}`, { undo });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="送冲"
      footer={<button className="btn primary block" disabled={!picked.length} onClick={submit}>送冲 {picked.length} 卷</button>}
    >
      <div className="form">
        <Field label="哪些卷一起送">
          <ul className="check-list">
            {shot.map((r) => {
              const s = stocks.find((x) => x.id === r.stockId);
              const on = picked.includes(r.id);
              return (
                <li key={r.id}>
                  <button type="button" className={`check-row ${on ? 'on' : ''}`} onClick={() => setPicked(on ? picked.filter((x) => x !== r.id) : [...picked, r.id])}>
                    <span className="check-box">{on ? '✓' : ''}</span>
                    <Canister stock={s} size={22} />
                    <span>{s?.brand} {s?.name}</span>
                    <span className="mono muted">{FORMAT_LABEL[r.format]}</span>
                  </button>
                </li>
              );
            })}
            {!shot.length && <li className="muted pad">没有待冲的胶卷</li>}
          </ul>
        </Field>
        <Field label="冲洗店">
          {labs.length > 0 && (
            <select className="input" value={newLab ? '' : labId} onChange={(e) => { setLabId(e.target.value); setNewLab(''); }}>
              {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <input className="input" style={{ marginTop: labs.length ? 8 : 0 }} placeholder={labs.length ? '或填写新的冲洗店' : '冲洗店名称'} value={newLab} onChange={(e) => setNewLab(e.target.value)} />
        </Field>
        <Field label="预计取回日期（可选）">
          <input className="input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </Field>
        <details className="more">
          <summary>费用与要求</summary>
          <Field label="费用"><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="冲扫要求"><input className="input" value={requests} onChange={(e) => setRequests(e.target.value)} placeholder="例如 高分辨率扫描 / 只冲不扫" /></Field>
        </details>
      </div>
    </BottomSheet>
  );
}

/* ────────────────────────────── 归档 ────────────────────────────── */

function ArchiveSheet({ state, onClose }: { state: { rollId: string } | null; onClose: () => void }) {
  const open = !!state;
  const toast = useToast();
  const ritual = useRitual();
  const roll = useLiveQuery(() => (state ? db.rolls.get(state.rollId) : undefined), [state?.rollId]);
  const stock = useLiveQuery(() => (roll ? db.stocks.get(roll.stockId) : undefined), [roll?.stockId]);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setRating(0); setNote(''); } }, [open]);

  async function submit() {
    if (!roll || !stock) return;
    try {
      const { undo, firstOfStock } = await archiveRoll(roll.id, { rating: rating || undefined, note: note || undefined });
      onClose();
      if (firstOfStock) {
        const [lit, total] = await Promise.all([
          db.rolls.where('status').equals('archived').toArray().then((rs) => new Set(rs.map((r) => r.stockId)).size),
          db.stocks.count(),
        ]);
        await ritual.play('light', { stock, litCount: lit, litTotal: total });
      }
      toast.show('已归档', { undo });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="归档" footer={<button className="btn primary block" onClick={submit}>归档这一卷</button>}>
      <div className="form">
        <div className="selected-stock">
          <Canister stock={stock} size={40} />
          <div><strong>{stock?.brand} {stock?.name}</strong></div>
        </div>
        <Field label="这卷拍得怎么样">
          <Stars value={rating} onChange={setRating} />
        </Field>
        <Field label="一句话笔记（可选）">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如 阴天色彩很沉，颗粒漂亮" />
        </Field>
      </div>
    </BottomSheet>
  );
}

/* ────────────────────────────── 品种表单 ────────────────────────────── */

const ALL_FORMATS: FilmFormat[] = ['135', '120', '4x5', '110'];

function StockFormSheet({ state, onClose }: { state: { stockId?: string; onDone?: (id: string) => void } | null; onClose: () => void }) {
  const open = !!state;
  const toast = useToast();
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [iso, setIso] = useState('400');
  const [type, setType] = useState<FilmType>('color-neg');
  const [formats, setFormats] = useState<FilmFormat[]>(['135']);
  const [discontinued, setDiscontinued] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (state?.stockId) {
      db.stocks.get(state.stockId).then((s) => {
        if (!s) return;
        setBrand(s.brand); setName(s.name); setIso(String(s.iso)); setType(s.type); setFormats(s.formats); setDiscontinued(s.discontinued);
      });
    } else {
      setBrand(''); setName(''); setIso('400'); setType('color-neg'); setFormats(['135']); setDiscontinued(false);
    }
  }, [open, state?.stockId]);

  async function submit() {
    const isoN = num(iso);
    if (!brand.trim() || !name.trim() || !isoN || isoN <= 0) {
      toast.show('请填写品牌、名称和有效的 ISO', { tone: 'error' });
      return;
    }
    if (!formats.length) { toast.show('至少选一种画幅', { tone: 'error' }); return; }
    const id = state?.stockId ?? 'custom-' + uid();
    if (state?.stockId) {
      await db.stocks.update(id, { brand: brand.trim(), name: name.trim(), iso: isoN, type, formats, discontinued });
    } else {
      await db.stocks.add({ id, brand: brand.trim(), name: name.trim(), iso: isoN, type, formats, discontinued, builtIn: false });
    }
    state?.onDone?.(id);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={state?.stockId ? '编辑品种' : '新建品种'} footer={<button className="btn primary block" onClick={submit}>保存</button>}>
      <div className="form">
        <Field label="品牌"><input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Kodak" /></Field>
        <Field label="名称"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Portra 400" /></Field>
        <Field label="ISO"><input className="input" inputMode="numeric" value={iso} onChange={(e) => setIso(e.target.value)} /></Field>
        <Field label="类型">
          <Segmented value={type} onChange={setType} options={(Object.keys(TYPE_LABEL) as FilmType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        </Field>
        <Field label="画幅（可多选）">
          <div className="chips">
            {ALL_FORMATS.map((f) => (
              <button key={f} type="button" className={`chip ${formats.includes(f) ? 'on' : ''}`} onClick={() => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f])}>
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </Field>
        <Switch checked={discontinued} onChange={setDiscontinued} label="已停产" />
      </div>
    </BottomSheet>
  );
}

/* ────────────────────────────── 相机表单 ────────────────────────────── */

function CameraFormSheet({ state, onClose }: { state: { cameraId?: string; onDone?: (id: string) => void } | null; onClose: () => void }) {
  const open = !!state;
  const toast = useToast();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<FilmFormat>('135');
  const [note, setNote] = useState('');
  const [photoId, setPhotoId] = useState<string>();
  const [ret, setRet] = useState(false);
  const [settings] = useSettings();
  void settings;

  useEffect(() => {
    if (!open) return;
    if (state?.cameraId) {
      db.cameras.get(state.cameraId).then((c) => {
        if (!c) return;
        setName(c.name); setFormat(c.format); setNote(c.note ?? ''); setPhotoId(c.photoId); setRet(c.retired);
      });
    } else {
      setName(''); setFormat('135'); setNote(''); setPhotoId(undefined); setRet(false);
    }
  }, [open, state?.cameraId]);

  async function submit() {
    if (!name.trim()) { toast.show('给相机起个名字', { tone: 'error' }); return; }
    const id = state?.cameraId ?? uid();
    const row = { id, name: name.trim(), format, note: note || undefined, photoId, retired: ret };
    await db.cameras.put(row);
    state?.onDone?.(id);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={state?.cameraId ? '编辑相机' : '新增相机'} footer={<button className="btn primary block" onClick={submit}>保存</button>}>
      <div className="form">
        <Field label="名称"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nikon FM2" autoFocus /></Field>
        <Field label="画幅">
          <Segmented value={format} onChange={setFormat} options={ALL_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))} />
        </Field>
        <Field label="照片（可选）">
          <PhotoInput onFile={async (f) => setPhotoId(await savePhoto(f, photoId))}>{photoId ? '更换照片' : '添加照片'}</PhotoInput>
        </Field>
        <Field label="备注"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {state?.cameraId && <Switch checked={ret} onChange={setRet} label="已封存（不再出现在上卷选择里）" />}
      </div>
    </BottomSheet>
  );
}

// 供其他模块使用的小工具
export { Chips };


/* ────────────────────────────── 补录旧胶卷 ────────────────────────────── */

function PastSheet({ state, onClose, api }: { state: { stockId?: string } | null; onClose: () => void; api: SheetsApi }) {
  const open = !!state;
  const toast = useToast();
  const ritual = useRitual();
  const stocks = useLiveQuery(() => db.stocks.toArray(), []) ?? [];
  const cameras = useLiveQuery(() => db.cameras.toArray(), []) ?? [];
  const labs = useLiveQuery(() => db.labs.toArray(), []) ?? [];
  const [stockId, setStockId] = useState<string>();
  const [q, setQ] = useState('');
  const [format, setFormat] = useState<FilmFormat>('135');
  const [count, setCount] = useState(1);
  const [shotAt, setShotAt] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [labId, setLabId] = useState('');
  const [final, setFinal] = useState<'archived' | 'back'>('archived');
  const [rating, setRating] = useState(0);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStockId(state?.stockId); setQ(''); setCount(1); setShotAt(''); setCameraId(''); setLabId('');
      setFinal('archived'); setRating(0); setPrice(''); setNote('');
    }
  }, [open, state?.stockId]);
  const stock = stocks.find((s) => s.id === stockId);
  useEffect(() => {
    if (stock) setFormat((f) => (stock.formats.includes(f) ? f : stock.formats[0]));
  }, [stock]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return [...stocks]
      .filter((s) => !k || `${s.brand} ${s.name}`.toLowerCase().includes(k) || String(s.iso) === k)
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.iso - b.iso)
      .slice(0, 80);
  }, [stocks, q]);

  async function submit() {
    if (!stock) return;
    setBusy(true);
    try {
      const { ids, firstOfStock, undo } = await addPastRolls({
        stockId: stock.id, format, count, shotAt: shotAt || undefined, cameraId: cameraId || undefined,
        labId: labId || undefined, finalStatus: final, rating: rating || undefined, price: num(price), note: note || undefined,
      });
      onClose();
      if (firstOfStock) {
        const [lit, total] = await Promise.all([
          db.rolls.where('status').equals('archived').toArray().then((rs) => new Set(rs.map((r) => r.stockId)).size),
          db.stocks.count(),
        ]);
        await ritual.play('light', { stock, litCount: lit, litTotal: total });
      }
      toast.show(`已补录 ${ids.length} 卷 ${stock.name}`, { undo });
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={stock ? '补录旧胶卷' : '选择品种'}
      footer={stock && <button className="btn primary block" disabled={busy} onClick={submit}>补录 {count} 卷</button>}
    >
      {!stock ? (
        <div className="picker">
          <input className="input" placeholder="搜索品牌 / 品种 / ISO" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="pick-list">
            {filtered.map((s) => (
              <li key={s.id}>
                <button className="pick-row" onClick={() => setStockId(s.id)}>
                  <Canister stock={s} size={26} />
                  <span className="pick-name">{s.brand} {s.name}</span>
                  <span className="pick-meta mono">{s.formats.map((f) => FORMAT_LABEL[f]).join(' / ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="btn ghost block" onClick={() => api.openStockForm(undefined, (id) => setStockId(id))}>找不到？新建品种</button>
        </div>
      ) : (
        <div className="form">
          <div className="selected-stock">
            <Canister stock={stock} size={40} />
            <div><strong>{stock.brand} {stock.name}</strong><div className="muted">ISO {stock.iso}</div></div>
            <button className="btn small ghost" onClick={() => setStockId(undefined)}>更换</button>
          </div>
          {stock.formats.length > 1 && (
            <Field label="画幅"><Segmented value={format} onChange={setFormat} options={stock.formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))} /></Field>
          )}
          <Field label="数量"><Stepper value={count} onChange={setCount} /></Field>
          <Field label="大概什么时候拍的" hint="可只填年月；留空 = 今天">
            <input className="input" type="month" value={shotAt.slice(0, 7)} onChange={(e) => setShotAt(e.target.value)} />
          </Field>
          <Field label="状态">
            <Segmented value={final} onChange={setFinal} options={[{ value: 'archived', label: '已归档（点亮图鉴）' }, { value: 'back', label: '已取回' }]} />
          </Field>
          {final === 'archived' && <Field label="评分（可选）"><Stars value={rating} onChange={setRating} /></Field>}
          <details className="more">
            <summary>相机、冲洗店、价格、笔记</summary>
            <Field label="相机">
              <select className="input" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                <option value="">不记录</option>
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="冲洗店">
              <select className="input" value={labId} onChange={(e) => setLabId(e.target.value)}>
                <option value="">不记录</option>
                {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="单价"><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            <Field label="笔记"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如 2023 年京都旅行" /></Field>
          </details>
        </div>
      )}
    </BottomSheet>
  );
}
