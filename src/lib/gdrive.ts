import { applyBackupKeepPhotos, buildHead, markBackedUp, type BackupFile } from '../db/backup';
import { db, type Photo } from '../db/schema';

/* Google Drive 同步（数据存在应用专属的隐藏空间 appDataFolder，只有本应用能看到，不占用户的文件列表）。
 * 模型：整库快照 + 修订号。每次上传把修订号 +1；上传前若云端修订号比本机上次同步的新，说明另一台设备改过，
 * 必须让用户选择保留哪边，不会悄悄覆盖。 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const LS = { client: 'filmshelf.gclient', rev: 'filmshelf.gsyncrev', at: 'filmshelf.gsyncat', on: 'filmshelf.gsync' };

const get = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const gClientId = () => get(LS.client);
export const setGClientId = (v: string) => put(LS.client, v.trim());
export const gLastSync = () => get(LS.at);
export const gAutoOn = () => get(LS.on) === '1';
export const setGAuto = (on: boolean) => put(LS.on, on ? '1' : '');

export class ConflictError extends Error {
  constructor(public cloudAt: string) { super('云端有另一台设备的更新'); }
}

let gisP: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  return (gisP ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res();
    s.onerror = () => { gisP = null; rej(new Error('无法加载 Google 登录组件，请检查网络')); };
    document.head.appendChild(s);
  }));
}

let token = { value: '', exp: 0 };
/** interactive=false 时只尝试静默获取，失败返回空串 */
export async function getToken(interactive: boolean): Promise<string> {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const clientId = gClientId();
  if (!clientId) throw new Error('还没有填写 Google 客户端 ID');
  await loadGis();
  return new Promise((res, rej) => {
    const c = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: interactive ? '' : 'none',
      callback: (r: any) => {
        if (r.error) { if (interactive) rej(new Error(`Google 授权失败：${r.error_description || r.error}`)); else res(''); return; }
        token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 };
        res(token.value);
      },
      error_callback: (e: any) => { if (interactive) rej(new Error(`Google 授权失败：${e?.type || '已取消'}`)); else res(''); },
    });
    c.requestAccessToken();
  });
}

async function api(path: string, init: RequestInit = {}, base = API): Promise<Response> {
  const t = await getToken(true);
  const r = await fetch(base + path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`Google Drive 返回 ${r.status}${r.status === 403 ? '（请确认已启用 Drive API）' : ''}`);
  return r;
}

async function listAll(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let page = '';
  do {
    const r = await (await api(`/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name)${page ? `&pageToken=${page}` : ''}`)).json();
    for (const f of r.files ?? []) m.set(f.name, f.id);
    page = r.nextPageToken ?? '';
  } while (page);
  return m;
}

async function upload(name: string, blob: Blob, existingId?: string): Promise<void> {
  const meta = existingId ? { name } : { name, parents: ['appDataFolder'] };
  const init = await api(`/files${existingId ? `/${existingId}` : ''}?uploadType=resumable`, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream' },
    body: JSON.stringify(meta),
  }, UP);
  const loc = init.headers.get('Location');
  if (!loc) throw new Error('上传失败：没有拿到上传地址');
  const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  if (!r.ok) throw new Error(`上传失败 ${r.status}`);
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
interface CloudData extends Omit<BackupFile, 'photos'> { rev: number; photos: { id: string; width: number; height: number; type: string; file: string }[] }

async function readCloudData(files: Map<string, string>): Promise<CloudData | null> {
  const id = files.get('data.json');
  if (!id) return null;
  return (await (await api(`/files/${id}?alt=media`)).json()) as CloudData;
}

export interface SyncStatus { cloudRev: number; cloudAt: string; localRev: number; cloudNewer: boolean; hasCloud: boolean }
export async function checkCloud(): Promise<SyncStatus> {
  const files = await listAll();
  const d = await readCloudData(files);
  const localRev = +get(LS.rev) || 0;
  if (!d) return { cloudRev: 0, cloudAt: '', localRev, cloudNewer: false, hasCloud: false };
  return { cloudRev: d.rev, cloudAt: d.exportedAt, localRev, cloudNewer: d.rev > localRev, hasCloud: true };
}

/** 本机 → 云端。force=true 时无视冲突，以本机为准。 */
export async function syncUp(opts: { force?: boolean; onProgress?: (text: string) => void } = {}): Promise<{ photos: number }> {
  const say = opts.onProgress ?? (() => {});
  say('读取云端…');
  const files = await listAll();
  const cloud = await readCloudData(files);
  const localRev = +get(LS.rev) || 0;
  if (cloud && cloud.rev > localRev && !opts.force) throw new ConflictError(cloud.exportedAt);
  const { head } = await buildHead(true);
  const ids = await db.photos.toCollection().primaryKeys();
  const meta: CloudData['photos'] = [];
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    const p = await db.photos.get(ids[i]);
    if (!p) continue;
    const file = `p-${p.id}.${EXT[p.blob.type] ?? 'bin'}`;
    meta.push({ id: p.id, width: p.width, height: p.height, type: p.blob.type, file });
    if (!files.has(file)) { say(`上传图片 ${i + 1}/${ids.length}`); await upload(file, p.blob); n++; }
  }
  const rev = Math.max(cloud?.rev ?? 0, localRev) + 1;
  say('写入记录…');
  await upload('data.json', new Blob([JSON.stringify({ ...head, photos: meta, rev })], { type: 'application/json' }), files.get('data.json'));
  // 清理云端不再引用的图片
  const keep = new Set(meta.map((m) => m.file));
  for (const [name, id] of files) if (name.startsWith('p-') && !keep.has(name)) await api(`/files/${id}`, { method: 'DELETE' }).catch(() => {});
  put(LS.rev, String(rev)); put(LS.at, new Date().toISOString());
  await markBackedUp();
  return { photos: n };
}

/** 云端 → 本机（覆盖本机记录，调用方先确认）。 */
export async function syncDown(opts: { onProgress?: (text: string) => void } = {}): Promise<{ photos: number }> {
  const say = opts.onProgress ?? (() => {});
  say('读取云端…');
  const files = await listAll();
  const cloud = await readCloudData(files);
  if (!cloud) throw new Error('云端还没有数据');
  const have = new Set(await db.photos.toCollection().primaryKeys());
  const add: Photo[] = [];
  const need = cloud.photos.filter((p) => !have.has(p.id));
  for (let i = 0; i < need.length; i++) {
    const m = need[i];
    const id = files.get(m.file);
    if (!id) continue;
    say(`下载图片 ${i + 1}/${need.length}`);
    const blob = await (await api(`/files/${id}?alt=media`)).blob();
    add.push({ id: m.id, width: m.width, height: m.height, blob: new Blob([blob], { type: m.type }) });
  }
  await applyBackupKeepPhotos(cloud as unknown as BackupFile, add);
  put(LS.rev, String(cloud.rev)); put(LS.at, new Date().toISOString());
  return { photos: add.length };
}

/** 启动时：开启了自动同步且能静默拿到令牌时，没有冲突就自动上传；有冲突返回 'conflict' 交给用户。 */
export async function maybeAutoSync(): Promise<'done' | 'skipped' | 'conflict'> {
  if (!gAutoOn() || !gClientId()) return 'skipped';
  const last = Date.parse(gLastSync() || '0');
  if (Date.now() - last < 6 * 3600_000) return 'skipped';
  try {
    if (!(await getToken(false))) return 'skipped';
    await syncUp();
    return 'done';
  } catch (e) {
    return e instanceof ConflictError ? 'conflict' : 'skipped';
  }
}
