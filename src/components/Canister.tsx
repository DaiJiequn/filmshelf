import { useId } from 'react';
import type { FilmStock } from '../db/schema';
import { brandColors } from '../lib/image';

interface Props {
  stock?: Pick<FilmStock, 'brand' | 'name' | 'iso'> & Partial<FilmStock>;
  size?: number;
  expired?: boolean;
  /** 图鉴未点亮：灰色剪影 */
  unlit?: boolean;
  sealed?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** 手绘风 135 胶卷罐（SVG）。品牌色由 brandColors 决定。 */
export function Canister({ stock, size = 64, expired, unlit, sealed, className = '', style }: Props) {
  const gid = useId().replace(/:/g, '');
  const c = brandColors(stock?.brand ?? '');
  const name = stock?.name ?? '';
  const short = name.length > 11 ? name.slice(0, 11) : name;
  return (
    <svg
      viewBox="0 0 80 120"
      width={size}
      height={size * 1.5}
      className={`canister ${expired ? 'breathe' : ''} ${unlit ? 'unlit' : ''} ${className}`}
      style={style}
      role="img"
      aria-label={stock ? `${stock.brand} ${stock.name}` : '胶卷'}
    >
      <defs>
        <linearGradient id={`b${gid}`} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".38" />
          <stop offset=".28" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".42" />
        </linearGradient>
      </defs>
      {/* spool tip */}
      <rect x="35" y="2" width="10" height="9" rx="2" fill="#8a8178" />
      <rect x="37" y="0" width="6" height="4" rx="1.5" fill="#a39a90" />
      {/* top cap */}
      <rect x="12" y="10" width="56" height="12" rx="5" fill="#6d665f" />
      {/* body */}
      <rect x="14" y="20" width="52" height="82" rx="3" fill={unlit ? '#4a4540' : c.body} />
      {/* label */}
      <rect x="14" y="40" width="52" height="42" fill={unlit ? '#5a544e' : c.label} />
      <rect x="14" y="40" width="52" height="5" fill={unlit ? '#3d3935' : c.body} opacity=".85" />
      <text x="40" y="60" textAnchor="middle" fontSize="8.4" fontWeight="800" fill={unlit ? '#2d2925' : c.ink} fontFamily="ui-sans-serif, system-ui, sans-serif">
        {unlit ? '???' : short}
      </text>
      <text x="40" y="74" textAnchor="middle" fontSize="11" fontWeight="900" fill={unlit ? '#2d2925' : c.ink} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
        {unlit ? '' : stock?.iso}
      </text>
      {/* shine */}
      <rect x="14" y="20" width="52" height="82" rx="3" fill={`url(#b${gid})`} />
      {/* bottom cap */}
      <rect x="12" y="98" width="56" height="12" rx="5" fill="#6d665f" />
      <rect x="35" y="108" width="10" height="7" rx="2" fill="#8a8178" />
      {sealed && (
        <g>
          <rect x="14" y="30" width="52" height="5" fill="#fff" opacity=".85" />
          <rect x="14" y="31.5" width="52" height="2" fill="#e8654e" opacity=".9" />
        </g>
      )}
    </svg>
  );
}
