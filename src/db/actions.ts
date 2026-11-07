import { db, nowIso, uid, type FilmFormat, type Frame, type LabVisit, type Roll } from './schema';
import { importScan, type ScanQuality } from '../lib/image';
import { transition } from '../domain/roll-state';

export type Undo = () => Promise<void>;

export interface AddRollsInput {
  stockId: string;
  format: FilmFormat;
  count: number;
  expiry?: string;
  batchNo?: string;
  price?: number;
  boughtAt?: string;
  boughtFrom?: string;
  locationId?: string;
  keepSealed?: boolean;
}

/** 入库：一次生成 N 卷 */
export async function addRolls(input: AddRollsInput): Promise<{ ids: string[]; undo: Undo }> {
  const at = nowIso();
  const count = Math.max(1, Math.min(99, Math.floor(input.count)));
  const rolls: Roll[] = Array.from({ length: count }, () => ({
    id: uid(),
    stockId: input.stockId,
    format: input.format,
    status: 'stock' as const,
    keepSealed: !!input.keepSealed,
    expiry: input.expiry || undefined,
    batchNo: input.batchNo || undefined,
    price: input.price,
    boughtAt: input.boughtAt || undefined,
    boughtFrom: input.boughtFrom || undefined,
    locationId: input.locationId || undefined,
    history: [{ status: 'stock' as const, at }],
    createdAt: at,
    updatedAt: at,
  }));
  await db.rolls.bulkAdd(rolls);
  const ids = rolls.map((r) => r.id);
  return { ids, undo: async () => void (await db.rolls.bulkDelete(ids)) };
}

async function restoreRolls(before: Roll[]) {
  await db.rolls.bulkPut(before);
}

/** 上卷：一台相机同一时间只能有一卷在机 */
export async function loadRoll(
  rollId: string,
  opts: { cameraId: string; shotIso?: number },
): Promise<{ undo: Undo; remaining: number }> {
  return db.transaction('rw', db.rolls, db.stocks, async () => {
    const roll = await db.rolls.get(rollId);
    if (!roll) throw new Error('找不到这卷胶卷');
    const busy = await db.rolls.where('cameraId').equals(opts.cameraId).filter((r) => r.status === 'loaded').first();
    if (busy) throw new Error('这台相机里已经有一卷了，请先卸卷');
    const stock = await db.stocks.get(roll.stockId);
    const next = transition(roll, 'loaded', { cameraId: opts.cameraId, shotIso: opts.shotIso, defaultIso: stock?.iso }, nowIso());
    await db.rolls.put(next);
    const remaining = await db.rolls.where('stockId').equals(roll.stockId).filter((r) => r.status === 'stock').count();
    return { undo: () => restoreRolls([roll]), remaining };
  });
}

/** 卸卷：相机释放 */
export async function unloadRoll(rollId: string, framesShot?: number): Promise<{ undo: Undo }> {
  const roll = await db.rolls.get(rollId);
  if (!roll) throw new Error('找不到这卷胶卷');
  const next = transition(roll, 'shot', { framesShot }, nowIso());
  await db.rolls.put(next);
  return { undo: () => restoreRolls([roll]) };
}

/** 送冲：多卷一次送出，生成一条冲洗记录 */
export async function sendToLab(
  rollIds: string[],
  opts: { labId: string; expectedAt?: string; cost?: number; requests?: string },
): Promise<{ visitId: string; undo: Undo }> {
  if (!rollIds.length) throw new Error('请选择要送冲的胶卷');
  return db.transaction('rw', db.rolls, db.labVisits, async () => {
    const at = nowIso();
    const before = (await db.rolls.bulkGet(rollIds)).filter((r): r is Roll => !!r);
    const visit: LabVisit = {
      id: uid(),
      labId: opts.labId,
      rollIds: before.map((r) => r.id),
      sentAt: at,
      expectedAt: opts.expectedAt || undefined,
      cost: opts.cost,
      requests: opts.requests || undefined,
    };
    const after = before.map((r) => transition(r, 'at-lab', { labVisitId: visit.id }, at));
    await db.labVisits.add(visit);
    await db.rolls.bulkPut(after);
    return {
      visitId: visit.id,
      undo: async () => {
        await db.rolls.bulkPut(before);
        await db.labVisits.delete(visit.id);
      },
    };
  });
}

/** 取回：可批量；一次冲洗的所有卷都取回后记录 backAt */
export async function returnFromLab(rollIds: string[]): Promise<{ undo: Undo }> {
  return db.transaction('rw', db.rolls, db.labVisits, async () => {
    const at = nowIso();
    const before = (await db.rolls.bulkGet(rollIds)).filter((r): r is Roll => !!r);
    const visitIds = [...new Set(before.map((r) => r.labVisitId).filter((x): x is string => !!x))];
    const visitsBefore = (await db.labVisits.bulkGet(visitIds)).filter((v): v is LabVisit => !!v);
    const after = before.map((r) => transition(r, 'back', {}, at));
    await db.rolls.bulkPut(after);
    for (const v of visitsBefore) {
      const rolls = (await db.rolls.bulkGet(v.rollIds)).filter((r): r is Roll => !!r);
      if (rolls.every((r) => r.status !== 'at-lab')) await db.labVisits.update(v.id, { backAt: at });
    }
    return {
      undo: async () => {
        await db.rolls.bulkPut(before);
        await db.labVisits.bulkPut(visitsBefore);
      },
    };
  });
}

/** 归档：该品种的第一次归档会点亮图鉴 */
export async function archiveRoll(
  rollId: string,
  opts: { rating?: number; note?: string } = {},
): Promise<{ undo: Undo; firstOfStock: boolean }> {
  const roll = await db.rolls.get(rollId);
  if (!roll) throw new Error('找不到这卷胶卷');
  const already = await db.rolls.where('stockId').equals(roll.stockId).filter((r) => r.status === 'archived').count();
  const next = transition(roll, 'archived', opts, nowIso());
  await db.rolls.put(next);
  return { undo: () => restoreRolls([roll]), firstOfStock: already === 0 };
}

export async function updateRoll(id: string, patch: Partial<Roll>): Promise<void> {
  await db.rolls.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteRoll(id: string): Promise<void> {
  const roll = await db.rolls.get(id);
  if (!roll) return;
  if (roll.labVisitId) {
    const v = await db.labVisits.get(roll.labVisitId);
    if (v) {
      const rest = v.rollIds.filter((x) => x !== id);
      if (rest.length) await db.labVisits.update(v.id, { rollIds: rest });
      else await db.labVisits.delete(v.id);
    }
  }
  await deleteFramesOf(id);
  await db.rolls.delete(id);
}

async function deleteFramesOf(rollId: string): Promise<void> {
  const frames = await db.frames.where('rollId').equals(rollId).toArray();
  await db.photos.bulkDelete(frames.flatMap((f) => [f.photoId, f.thumbId]));
  await db.frames.bulkDelete(frames.map((f) => f.id));
}

/** 品种下有卷时不能删除 */
export async function deleteStock(id: string): Promise<void> {
  const n = await db.rolls.where('stockId').equals(id).count();
  if (n > 0) throw new Error(`这个品种下还有 ${n} 卷胶卷，不能删除`);
  await db.stocks.delete(id);
}

export async function deleteCamera(id: string): Promise<void> {
  const used = await db.rolls.where('cameraId').equals(id).count();
  if (used > 0) {
    await db.cameras.update(id, { retired: true }); // 有历史记录的相机只能封存
    return;
  }
  await db.cameras.delete(id);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return (row ? (row.value as T) : fallback) as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export interface PastRollsInput {
  stockId: string;
  format: FilmFormat;
  count: number;
  shotAt?: string; // YYYY-MM-DD 或 YYYY-MM，缺省为今天
  cameraId?: string;
  labId?: string;
  finalStatus: 'back' | 'archived';
  rating?: number;
  note?: string;
  price?: number;
  cost?: number; // 冲洗总费用（整批）
}

/** 补录已冲洗完的旧胶卷：直接生成「已取回/已归档」的卷，历史里补齐全部步骤。 */
export async function addPastRolls(
  input: PastRollsInput,
): Promise<{ ids: string[]; firstOfStock: boolean; undo: Undo }> {
  const count = Math.max(1, Math.min(99, Math.floor(input.count)));
  const raw = input.shotAt ? (input.shotAt.length === 7 ? `${input.shotAt}-01` : input.shotAt) : undefined;
  const d = raw ? new Date(`${raw}T12:00:00`) : new Date();
  const at = (Number.isNaN(d.getTime()) ? new Date() : d).toISOString();
  const created = nowIso();
  const stock = await db.stocks.get(input.stockId);
  const already = await db.rolls.where('stockId').equals(input.stockId).filter((r) => r.status === 'archived').count();
  const visitId = input.labId ? uid() : undefined;
  const steps: Roll['history'] = (['stock', 'loaded', 'shot', ...(visitId ? ['at-lab'] : []), 'back', ...(input.finalStatus === 'archived' ? ['archived'] : [])] as Roll['status'][]).map(
    (status) => ({ status, at }),
  );
  const rolls: Roll[] = Array.from({ length: count }, () => ({
    id: uid(),
    stockId: input.stockId,
    format: input.format,
    status: input.finalStatus,
    keepSealed: false,
    price: input.price,
    shotIso: stock?.iso,
    cameraId: input.cameraId || undefined,
    loadedAt: at,
    unloadedAt: at,
    labVisitId: visitId,
    rating: input.finalStatus === 'archived' && input.rating ? input.rating : undefined,
    note: input.note || undefined,
    history: steps,
    createdAt: created,
    updatedAt: created,
  }));
  const ids = rolls.map((r) => r.id);
  await db.transaction('rw', db.rolls, db.labVisits, async () => {
    await db.rolls.bulkAdd(rolls);
    if (visitId) await db.labVisits.add({ id: visitId, labId: input.labId!, rollIds: ids, sentAt: at, backAt: at, cost: input.cost });
  });
  return {
    ids,
    firstOfStock: input.finalStatus === 'archived' && already === 0,
    undo: async () => {
      await db.rolls.bulkDelete(ids);
      if (visitId) await db.labVisits.delete(visitId);
    },
  };
}


/** 导入扫描件：按文件名自然排序，依次压缩入库。单张失败不影响其他张。 */
export async function addFrames(
  rollId: string,
  files: File[],
  quality: ScanQuality,
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; failed: string[] }> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const last = await db.frames.where('rollId').equals(rollId).sortBy('order');
  let order = last.length ? last[last.length - 1].order + 1 : 0;
  const failed: string[] = [];
  let added = 0;
  for (let i = 0; i < sorted.length; i++) {
    onProgress?.(i, sorted.length);
    try {
      const img = await importScan(sorted[i], quality);
      const frame: Frame = { id: uid(), rollId, order: order++, ...img, createdAt: nowIso() };
      await db.frames.add(frame);
      added++;
    } catch {
      failed.push(sorted[i].name);
    }
  }
  onProgress?.(sorted.length, sorted.length);
  return { added, failed };
}

export async function updateFrame(id: string, patch: Partial<Frame>): Promise<void> {
  await db.frames.update(id, patch);
}

export async function deleteFrame(id: string): Promise<void> {
  const f = await db.frames.get(id);
  if (!f) return;
  await db.photos.bulkDelete([f.photoId, f.thumbId]);
  await db.frames.delete(id);
}
