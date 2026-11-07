import { db, nowIso, type Photo } from './schema';
import { seedIfNeeded } from './seed-stocks';
import { setSetting } from './actions';

export const SCHEMA_VERSION = 2;

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
  /** 是否包含扫描件。不含时，导入会保留本机已有的扫描件。 */
  includesScans?: boolean;
  stocks: unknown[];
  rolls: unknown[];
  cameras: unknown[];
  labs: unknown[];
  labVisits: unknown[];
  locations: unknown[];
  settings: unknown[];
  frames?: { id: string; rollId: string; photoId: string; thumbId: string }[];
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

async function dumpPhoto(p: Photo): Promise<PhotoDump> {
  const buf = new Uint8Array(await p.blob.arrayBuffer());
  return { id: p.id, width: p.width, height: p.height, type: p.blob.type, data: bytesToBase64(buf) };
}

/** 逐张拼接成 Blob，避免一次性生成超大字符串。withScans=false 时不含扫描件（备份小很多）。 */
export async function buildHead(withScans: boolean) {
  const frames = await db.frames.toArray();
  const scanPhotoIds = new Set(frames.flatMap((f) => [f.photoId, f.thumbId, ...(f.origPhotoId ? [f.origPhotoId] : [])]));
  const head = {
    app: 'film-shelf',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    includesScans: withScans,
    stocks: await db.stocks.toArray(),
    rolls: await db.rolls.toArray(),
    cameras: await db.cameras.toArray(),
    labs: await db.labs.toArray(),
    labVisits: await db.labVisits.toArray(),
    locations: await db.locations.toArray(),
    settings: (await db.settings.toArray()).filter((s) => s.key !== 'lastBackupAt'),
    frames: withScans ? frames : [],
  };
  return { head, scanPhotoIds };
}

export async function exportBackupBlob(withScans: boolean): Promise<Blob> {
  const { head, scanPhotoIds } = await buildHead(withScans);
  const parts: string[] = [JSON.stringify(head).slice(0, -1) + ',"photos":['];
  let first = true;
  for (const id of await db.photos.toCollection().primaryKeys()) {
    if (!withScans && scanPhotoIds.has(id)) continue;
    const p = await db.photos.get(id);
    if (!p) continue;
    parts.push((first ? '' : ',') + JSON.stringify(await dumpPhoto(p)));
    first = false;
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

export async function exportBackup(): Promise<BackupFile> {
  return JSON.parse(await (await exportBackupBlob(true)).text()) as BackupFile;
}

/** 估算备份大小（字节，base64 后约 4/3） */
export async function estimateBackupSize(): Promise<{ withScans: number; withoutScans: number }> {
  const frames = await db.frames.toArray();
  const scanIds = new Set(frames.flatMap((f) => [f.photoId, f.thumbId, ...(f.origPhotoId ? [f.origPhotoId] : [])]));
  let scans = 0;
  let other = 0;
  await db.photos.each((p) => {
    if (scanIds.has(p.id)) scans += p.blob.size;
    else other += p.blob.size;
  });
  const base = 200_000;
  return { withScans: Math.round((scans + other) * 1.34) + base, withoutScans: Math.round(other * 1.34) + base };
}

/** 云同步用：覆盖所有记录，但图片只补充 newPhotos，并删掉备份里不再引用的图片（不必把所有图片载入内存）。 */
export async function applyBackupKeepPhotos(file: BackupFile, newPhotos: Photo[]): Promise<void> {
  validateBackup(file);
  const want = new Set(file.photos.map((p) => p.id));
  const others = ALL().filter((t) => t !== db.photos);
  await db.transaction('rw', ALL(), async () => {
    await Promise.all(others.map((t) => t.clear()));
    await db.stocks.bulkAdd(file.stocks as never[]);
    await db.rolls.bulkAdd(file.rolls as never[]);
    await db.cameras.bulkAdd(file.cameras as never[]);
    await db.labs.bulkAdd(file.labs as never[]);
    await db.labVisits.bulkAdd(file.labVisits as never[]);
    await db.locations.bulkAdd(file.locations as never[]);
    await db.settings.bulkAdd(file.settings as never[]);
    if (file.frames?.length) await db.frames.bulkAdd(file.frames as never[]);
    await db.photos.bulkPut(newPhotos);
    const have = await db.photos.toCollection().primaryKeys();
    await db.photos.bulkDelete(have.filter((id) => !want.has(id)));
  });
  await seedIfNeeded();
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

const ALL = () => [db.stocks, db.rolls, db.cameras, db.labs, db.labVisits, db.locations, db.photos, db.settings, db.frames];

/** 导入会覆盖当前数据（调用方需先确认）。校验失败时不会动现有数据。
 *  备份不含扫描件时，本机已有的扫描件会保留（只保留所属胶卷仍存在的）。 */
export async function importBackup(file: unknown): Promise<void> {
  validateBackup(file);
  const photos: Photo[] = file.photos.map((p) => ({
    id: p.id, width: p.width, height: p.height,
    blob: new Blob([base64ToBytes(p.data) as BlobPart], { type: p.type }),
  }));
  await applyBackup(file, photos);
}

/** 把备份内容写入数据库（photos 已解码为 Blob）。文件夹备份也走这里。 */
export async function applyBackup(file: BackupFile, photos: Photo[]): Promise<void> {
  const rollIds = new Set((file.rolls as { id: string }[]).map((r) => r.id));
  await db.transaction('rw', ALL(), async () => {
    const keep = file.includesScans === false || (file.schemaVersion < 2)
      ? (await db.frames.toArray()).filter((f) => rollIds.has(f.rollId))
      : [];
    const keepPhotos = (await db.photos.bulkGet(keep.flatMap((f) => [f.photoId, f.thumbId, ...(f.origPhotoId ? [f.origPhotoId] : [])]))).filter((p): p is Photo => !!p);
    await Promise.all(ALL().map((t) => t.clear()));
    await db.stocks.bulkAdd(file.stocks as never[]);
    await db.rolls.bulkAdd(file.rolls as never[]);
    await db.cameras.bulkAdd(file.cameras as never[]);
    await db.labs.bulkAdd(file.labs as never[]);
    await db.labVisits.bulkAdd(file.labVisits as never[]);
    await db.locations.bulkAdd(file.locations as never[]);
    await db.settings.bulkAdd(file.settings as never[]);
    await db.photos.bulkAdd(photos);
    if (keep.length) {
      await db.photos.bulkPut(keepPhotos);
      await db.frames.bulkAdd(keep);
    } else if (file.frames?.length) {
      await db.frames.bulkAdd(file.frames as never[]);
    }
  });
  await seedIfNeeded();
}

export async function markBackedUp(): Promise<void> {
  await setSetting('lastBackupAt', nowIso());
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', ALL(), async () => {
    await Promise.all(ALL().map((t) => t.clear()));
  });
  await seedIfNeeded();
}
