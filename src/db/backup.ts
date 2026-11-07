import { db, nowIso, type Photo } from './schema';
import { seedIfNeeded } from './seed-stocks';
import { setSetting } from './actions';

export const SCHEMA_VERSION = 1;

interface PhotoDump {
  id: string;
  width: number;
  height: number;
  type: string;
  data: string; // base64
}

export interface BackupFile {
  app: 'film-shelf';
  schemaVersion: number;
  exportedAt: string;
  stocks: unknown[];
  rolls: unknown[];
  cameras: unknown[];
  labs: unknown[];
  labVisits: unknown[];
  locations: unknown[];
  settings: unknown[];
  photos: PhotoDump[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function exportBackup(): Promise<BackupFile> {
  const photos = await db.photos.toArray();
  const photoDumps: PhotoDump[] = [];
  for (const p of photos) {
    const buf = new Uint8Array(await p.blob.arrayBuffer());
    photoDumps.push({ id: p.id, width: p.width, height: p.height, type: p.blob.type, data: bytesToBase64(buf) });
  }
  return {
    app: 'film-shelf',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    stocks: await db.stocks.toArray(),
    rolls: await db.rolls.toArray(),
    cameras: await db.cameras.toArray(),
    labs: await db.labs.toArray(),
    labVisits: await db.labVisits.toArray(),
    locations: await db.locations.toArray(),
    settings: (await db.settings.toArray()).filter((s) => s.key !== 'lastBackupAt'),
    photos: photoDumps,
  };
}

export function validateBackup(x: unknown): asserts x is BackupFile {
  const f = x as Partial<BackupFile> | null;
  if (!f || f.app !== 'film-shelf') throw new Error('这不是胶卷柜的备份文件');
  if (typeof f.schemaVersion !== 'number') throw new Error('备份文件缺少版本号');
  if (f.schemaVersion > SCHEMA_VERSION) throw new Error('备份文件来自更新版本的应用，请先更新应用');
  for (const k of ['stocks', 'rolls', 'cameras', 'labs', 'labVisits', 'locations', 'settings', 'photos'] as const) {
    if (!Array.isArray(f[k])) throw new Error(`备份文件损坏：缺少 ${k}`);
  }
}

/** 导入会覆盖当前全部数据（调用方需先确认）。校验失败时不会动现有数据。 */
export async function importBackup(file: unknown): Promise<void> {
  validateBackup(file);
  const photos: Photo[] = file.photos.map((p) => ({
    id: p.id,
    width: p.width,
    height: p.height,
    blob: new Blob([base64ToBytes(p.data) as BlobPart], { type: p.type }),
  }));
  await db.transaction('rw', [db.stocks, db.rolls, db.cameras, db.labs, db.labVisits, db.locations, db.photos, db.settings], async () => {
    await Promise.all([
      db.stocks.clear(), db.rolls.clear(), db.cameras.clear(), db.labs.clear(),
      db.labVisits.clear(), db.locations.clear(), db.photos.clear(), db.settings.clear(),
    ]);
    await db.stocks.bulkAdd(file.stocks as never[]);
    await db.rolls.bulkAdd(file.rolls as never[]);
    await db.cameras.bulkAdd(file.cameras as never[]);
    await db.labs.bulkAdd(file.labs as never[]);
    await db.labVisits.bulkAdd(file.labVisits as never[]);
    await db.locations.bulkAdd(file.locations as never[]);
    await db.settings.bulkAdd(file.settings as never[]);
    await db.photos.bulkAdd(photos);
  });
  await seedIfNeeded();
}

export async function markBackedUp(): Promise<void> {
  await setSetting('lastBackupAt', nowIso());
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', [db.stocks, db.rolls, db.cameras, db.labs, db.labVisits, db.locations, db.photos, db.settings], async () => {
    await Promise.all([
      db.stocks.clear(), db.rolls.clear(), db.cameras.clear(), db.labs.clear(),
      db.labVisits.clear(), db.locations.clear(), db.photos.clear(), db.settings.clear(),
    ]);
  });
  await seedIfNeeded();
}
