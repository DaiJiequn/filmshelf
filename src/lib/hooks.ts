import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FilmFormat } from '../db/schema';
import { setSetting } from '../db/actions';

export interface Settings {
  motionLevel: 'full' | 'lite' | 'off';
  currency: string;
  expiryWarnMonths: number;
  scanQuality: 'standard' | 'high' | 'original';
  lastBackupAt?: string;
}

export const DEFAULT_SETTINGS: Settings = { motionLevel: 'full', currency: 'JPY', expiryWarnMonths: 3, scanQuality: 'standard' };

export function useSettings(): [Settings, <K extends keyof Settings>(k: K, v: Settings[K]) => Promise<void>] {
  const rows = useLiveQuery(() => db.settings.toArray(), []);
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows ?? []) (s as unknown as Record<string, unknown>)[r.key] = r.value;
  return [s, (k, v) => setSetting(k, v)];
}

/** 读取照片并生成 objectURL，卸载时释放 */
export function usePhotoUrl(id?: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let u: string | undefined;
    if (!id) {
      setUrl(undefined);
      return;
    }
    db.photos.get(id).then((p) => {
      if (alive && p) {
        u = URL.createObjectURL(p.blob);
        setUrl(u);
      }
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url;
}

export const FORMAT_LABEL: Record<FilmFormat, string> = { '135': '135', '120': '120', '4x5': '4×5', '110': '110' };

export function fmtMoney(v: number | undefined, currency: string): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
