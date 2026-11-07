import { applyBackup, buildHead, markBackedUp, validateBackup, type BackupFile } from '../db/backup';
import { db, type Photo } from '../db/schema';

/* 自动备份到用户选择的文件夹（File System Access API：Chrome / Edge / 桌面版）。
 * 文件夹结构：  data-latest.json（所有记录）、snapshots/（每天一份历史记录，保留最近 10 份）、photos/（每张图一个文件）。
 * 图片一旦生成就不会再改，所以只写新增的，之后每次备份很快。 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dir = any;

export interface AutoBackupConfig { enabled: boolean; everyDays: number; withScans: boolean }
const CFG_KEY = 'filmshelf.autobackup';
const DEFAULT_CFG: AutoBackupConfig = { enabled: false, everyDays: 1, withScans: true };

export const autoBackupSupported = () => typeof (window as any).showDirectoryPicker === 'function';

export function getConfig(): AutoBackupConfig {
  try { return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return DEFAULT_CFG; }
}
export function setConfig(c: AutoBackupConfig) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// ---- 目录句柄存在单独的 IndexedDB 里，刷新后仍然记得 ----
function kv<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((res, rej) => {
    const open = indexedDB.open('film-shelf-fs', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      try {
        const r = fn(open.result.transaction('kv', mode).objectStore('kv'));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    };
  });
}
let memDir: Dir | undefined; // IndexedDB 存不进句柄时（个别环境）至少本次运行内有效
export const getFolder = async (): Promise<Dir | undefined> => memDir ?? (await kv((s) => s.get('dir'), 'readonly').catch(() => undefined));
const saveFolder = async (d: Dir) => { memDir = d; await kv((s) => s.put(d, 'dir'), 'readwrite').catch(() => undefined); };
export const forgetFolder = async () => { memDir = undefined; await kv((s) => s.delete('dir'), 'readwrite').catch(() => undefined); };

export async function pickFolder(): Promise<Dir> {
  const d = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'filmshelf-backup' });
  await saveFolder(d);
  return d;
}

export async function hasPermission(d: Dir, ask: boolean): Promise<boolean> {
  const o = { mode: 'readwrite' };
  if ((await d.queryPermission(o)) === 'granted') return true;
  return ask && (await d.requestPermission(o)) === 'granted';
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function writeFile(dir: Dir, name: string, data: Blob | string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
async function exists(dir: Dir, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

export interface BackupResult { photosWritten: number; photosTotal: number }

/** 立即备份到已选文件夹。ask=true 时可弹出授权（需要在用户点击中调用）。 */
export async function runBackup(opts: { ask: boolean; onProgress?: (done: number, total: number) => void }): Promise<BackupResult> {
  const dir = await getFolder();
  if (!dir) throw new Error('还没有选择备份文件夹');
  if (!(await hasPermission(dir, opts.ask))) throw new Error('需要重新授权访问备份文件夹');
  const cfg = getConfig();
  const { head, scanPhotoIds } = await buildHead(cfg.withScans);
  const ids = (await db.photos.toCollection().primaryKeys()).filter((id) => cfg.withScans || !scanPhotoIds.has(id));
  const photosDir = await dir.getDirectoryHandle('photos', { create: true });
  const meta: { id: string; width: number; height: number; type: string; file: string }[] = [];
  let written = 0, done = 0;
  for (const id of ids) {
    const p = await db.photos.get(id);
    done++;
    if (!p) continue;
    const file = `${id}.${EXT[p.blob.type] ?? 'bin'}`;
    meta.push({ id, width: p.width, height: p.height, type: p.blob.type, file });
    if (!(await exists(photosDir, file))) { await writeFile(photosDir, file, p.blob); written++; }
    if (done % 5 === 0) opts.onProgress?.(done, ids.length);
  }
  // 先写完图片，最后才写记录：中途断掉时，旧的 data-latest.json 仍然完整可用
  const json = JSON.stringify({ ...head, photos: meta });
  const snaps = await dir.getDirectoryHandle('snapshots', { create: true });
  await writeFile(snaps, `data-${new Date().toISOString().slice(0, 10)}.json`, json);
  const names: string[] = [];
  for await (const [n] of snaps.entries()) if (/^data-\d{4}-\d{2}-\d{2}\.json$/.test(n)) names.push(n);
  names.sort();
  for (const n of names.slice(0, Math.max(0, names.length - 10))) await snaps.removeEntry(n);
  await writeFile(dir, 'data-latest.json', json);
  await markBackedUp();
  opts.onProgress?.(ids.length, ids.length);
  return { photosWritten: written, photosTotal: ids.length };
}

/** 启动时调用：开启了自动备份、已授权、且到期时静默备份。返回是否真的备份了。 */
export async function maybeAutoBackup(): Promise<'done' | 'skipped' | 'needs-permission'> {
  const cfg = getConfig();
  if (!cfg.enabled || !autoBackupSupported()) return 'skipped';
  const dir = await getFolder();
  if (!dir) return 'skipped';
  const last = (await db.settings.get('lastBackupAt'))?.value as string | undefined;
  if (last && Date.now() - Date.parse(last) < cfg.everyDays * 86_400_000) return 'skipped';
  if (!(await hasPermission(dir, false))) return 'needs-permission';
  await runBackup({ ask: false });
  return 'done';
}

/** 从备份文件夹恢复（覆盖当前数据，调用方先确认）。 */
export async function restoreFromFolder(dir?: Dir): Promise<void> {
  const d = dir ?? (await getFolder());
  if (!d) throw new Error('还没有选择备份文件夹');
  if (!(await hasPermission(d, true))) throw new Error('没有访问该文件夹的权限');
  let file: File;
  try { file = await (await d.getFileHandle('data-latest.json')).getFile(); } catch { throw new Error('这个文件夹里没有 data-latest.json，不是胶卷柜的备份文件夹'); }
  const json = JSON.parse(await file.text()) as BackupFile & { photos: { id: string; width: number; height: number; type: string; file: string }[] };
  validateBackup(json);
  const photosDir = await d.getDirectoryHandle('photos');
  const photos: Photo[] = [];
  for (const m of json.photos) {
    try {
      const f: File = await (await photosDir.getFileHandle(m.file)).getFile();
      photos.push({ id: m.id, width: m.width, height: m.height, blob: new Blob([f], { type: m.type }) });
    } catch { /* 缺失的图片跳过 */ }
  }
  await applyBackup(json, photos);
}
