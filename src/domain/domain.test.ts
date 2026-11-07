import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { expiryState, monthsToExpiry } from './expiry';
import { canTransition, NEXT_STATUS, transition, TransitionError } from './roll-state';
import { db, uid } from '../db/schema';
import { seedIfNeeded, SEED_STOCKS } from '../db/seed-stocks';
import {
  addRolls, archiveRoll, deleteCamera, deleteStock, loadRoll, returnFromLab, sendToLab, unloadRoll,
} from '../db/actions';
import { exportBackup, importBackup, validateBackup } from '../db/backup';

const now = new Date(2026, 10, 7); // 2026-11

describe('expiry', () => {
  it('classifies', () => {
    expect(expiryState(undefined, now, 3)).toBe('none');
    expect(expiryState('2026-10', now, 3)).toBe('expired');
    expect(expiryState('2026-11', now, 3)).toBe('soon'); // 当月不算过期
    expect(expiryState('2027-02', now, 3)).toBe('soon');
    expect(expiryState('2027-03', now, 3)).toBe('ok');
    expect(monthsToExpiry('2027-01', now)).toBe(2);
  });
});

describe('roll-state', () => {
  const base = () => ({
    id: 'r', stockId: 's', format: '135' as const, status: 'stock' as const, keepSealed: false,
    history: [], createdAt: 'x', updatedAt: 'x',
  });
  it('只能向前一步', () => {
    expect(canTransition(base(), 'loaded')).toBe(true);
    expect(canTransition(base(), 'shot')).toBe(false);
    expect(NEXT_STATUS.archived).toBeNull();
  });
  it('收藏封存的卷不能上卷', () => {
    expect(() => transition({ ...base(), keepSealed: true }, 'loaded', { cameraId: 'c' }, 't')).toThrow(TransitionError);
  });
  it('上卷需要相机，ISO 默认品种 ISO，并清空位置', () => {
    expect(() => transition(base(), 'loaded', {}, 't')).toThrow();
    const r = transition({ ...base(), locationId: 'L' }, 'loaded', { cameraId: 'c', defaultIso: 400 }, 't');
    expect(r.shotIso).toBe(400);
    expect(r.locationId).toBeUndefined();
    expect(r.history.at(-1)?.status).toBe('loaded');
  });
});

describe('actions', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await seedIfNeeded();
  });

  it('seed 幂等', async () => {
    expect(await db.stocks.count()).toBe(SEED_STOCKS.length);
    expect(await seedIfNeeded()).toBe(0);
  });

  it('完整流程 stock → archived 且图鉴首次点亮', async () => {
    const cam = { id: uid(), name: 'FM2', format: '135' as const, retired: false };
    await db.cameras.add(cam);
    await db.labs.add({ id: 'lab', name: '店' });
    const { ids } = await addRolls({ stockId: 'kodak-portra-400', format: '135', count: 3 });
    expect(ids).toHaveLength(3);

    const l = await loadRoll(ids[0], { cameraId: cam.id });
    expect(l.remaining).toBe(2);
    await expect(loadRoll(ids[1], { cameraId: cam.id })).rejects.toThrow(/已经有一卷/);

    await unloadRoll(ids[0], 36);
    await loadRoll(ids[1], { cameraId: cam.id }); // 相机已释放
    await unloadRoll(ids[1]);

    const { visitId } = await sendToLab([ids[0], ids[1]], { labId: 'lab', cost: 2400 });
    expect((await db.labVisits.get(visitId))?.rollIds).toHaveLength(2);

    await returnFromLab([ids[0]]);
    expect((await db.labVisits.get(visitId))?.backAt).toBeUndefined();
    await returnFromLab([ids[1]]);
    expect((await db.labVisits.get(visitId))?.backAt).toBeTruthy();

    const a1 = await archiveRoll(ids[0], { rating: 5 });
    expect(a1.firstOfStock).toBe(true);
    const a2 = await archiveRoll(ids[1]);
    expect(a2.firstOfStock).toBe(false);
  });

  it('撤销恢复快照', async () => {
    const cam = { id: uid(), name: 'X', format: '135' as const, retired: false };
    await db.cameras.add(cam);
    const { ids } = await addRolls({ stockId: 'kodak-gold-200', format: '135', count: 1 });
    const { undo } = await loadRoll(ids[0], { cameraId: cam.id });
    await undo();
    expect((await db.rolls.get(ids[0]))?.status).toBe('stock');
  });

  it('有卷的品种不能删除；有历史的相机只封存', async () => {
    const { ids } = await addRolls({ stockId: 'kodak-gold-200', format: '135', count: 1 });
    await expect(deleteStock('kodak-gold-200')).rejects.toThrow();
    const cam = { id: uid(), name: 'X', format: '135' as const, retired: false };
    await db.cameras.add(cam);
    await loadRoll(ids[0], { cameraId: cam.id });
    await deleteCamera(cam.id);
    expect((await db.cameras.get(cam.id))?.retired).toBe(true);
  });
});

describe('backup', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await seedIfNeeded();
  });

  it('导出再导入无损', async () => {
    await db.cameras.add({ id: 'c1', name: 'F3', format: '135', retired: false });
    await db.locations.add({ id: 'l1', name: '冰箱', order: 0 });
    await addRolls({ stockId: 'ilford-hp5-plus-400', format: '120', count: 2, price: 1200, expiry: '2028-01' });
    await db.settings.put({ key: 'currency', value: 'CNY' });
    const before = await exportBackup();
    const json = JSON.parse(JSON.stringify(before));
    await Promise.all(db.tables.map((t) => t.clear()));
    await importBackup(json);
    const after = await exportBackup();
    after.exportedAt = before.exportedAt;
    expect(after).toEqual(before);
  });

  it('损坏文件被拒绝且不动现有数据', async () => {
    await addRolls({ stockId: 'kodak-gold-200', format: '135', count: 1 });
    expect(() => validateBackup({ app: 'other' })).toThrow();
    await expect(importBackup({ app: 'film-shelf', schemaVersion: 1, rolls: [] })).rejects.toThrow();
    expect(await db.rolls.count()).toBe(1);
  });
});

describe('补录旧胶卷', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await seedIfNeeded();
  });
  it('直接生成已归档的卷，补齐历史并点亮图鉴，可撤销', async () => {
    await db.labs.add({ id: 'lab', name: '店' });
    const { addPastRolls } = await import('../db/actions');
    const r = await addPastRolls({ stockId: 'kodak-gold-200', format: '135', count: 2, shotAt: '2023-04', labId: 'lab', finalStatus: 'archived', rating: 4 });
    expect(r.firstOfStock).toBe(true);
    const rolls = await db.rolls.bulkGet(r.ids);
    expect(rolls[0]?.status).toBe('archived');
    expect(rolls[0]?.history.map((h) => h.status)).toEqual(['stock', 'loaded', 'shot', 'at-lab', 'back', 'archived']);
    expect(rolls[0]?.loadedAt?.startsWith('2023-04')).toBe(true);
    expect((await db.labVisits.get(rolls[0]!.labVisitId!))?.backAt).toBeTruthy();
    await r.undo();
    expect(await db.rolls.count()).toBe(0);
    expect(await db.labVisits.count()).toBe(0);
  });
});
