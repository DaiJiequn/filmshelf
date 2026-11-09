import type { Roll } from '../db/schema';

/** ISO 时间戳 → 本地日期 YYYY-MM-DD（直接截取 UTC 会在早上差一天） */
export function localDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 一卷的拍摄日期（本地）；补录时没填日期的卷返回 undefined */
export function shotDate(r: Roll): string | undefined {
  if (r.dateUnknown) return undefined;
  return localDate(r.unloadedAt ?? r.loadedAt);
}

/** 数字化的三种状态：未扫描 / 扫过但没导入 app / 扫描件已入库 */
export type DigitState = 'none' | 'external' | 'in';
export function digitState(r: Roll, frameCount: number): DigitState {
  if (frameCount > 0) return 'in';
  return r.neg?.scanned && r.neg.scanned !== 'none' ? 'external' : 'none';
}

/** 已冲洗出来的卷：已取回/已归档，或者已经有扫描件（有扫描件说明底片一定冲出来了） */
export const isDeveloped = (r: Roll, frameCount: number) => r.status === 'back' || r.status === 'archived' || frameCount > 0;
