export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';

/** 当前月份序号（year*12+month0） */
function monthIndex(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/**
 * 过期规则：过期月份早于当前月份 = 已过期；
 * 距过期不超过 warnMonths 个月 = 即将过期（仅库存状态的卷会被首页提醒，由调用方判断）。
 * 过期当月本身不算过期。
 */
export function expiryState(expiry: string | undefined, now: Date, warnMonths: number): ExpiryState {
  if (!expiry) return 'none';
  const e = monthIndex(expiry);
  if (e === null) return 'none';
  const cur = now.getFullYear() * 12 + now.getMonth();
  if (e < cur) return 'expired';
  if (e - cur <= warnMonths) return 'soon';
  return 'ok';
}

/** 距过期的月数（负数 = 已过期） */
export function monthsToExpiry(expiry: string, now: Date): number | null {
  const e = monthIndex(expiry);
  if (e === null) return null;
  return e - (now.getFullYear() * 12 + now.getMonth());
}

export function expiryText(expiry: string | undefined, now: Date): string {
  if (!expiry) return '无有效期';
  const d = monthsToExpiry(expiry, now);
  if (d === null) return expiry;
  if (d < 0) return `已过期 ${-d} 个月`;
  if (d === 0) return '本月到期';
  return `${d} 个月后到期`;
}

export function daysBetween(fromIso: string, now: Date): number {
  const ms = now.getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
