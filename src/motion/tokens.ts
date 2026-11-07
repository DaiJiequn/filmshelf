import { createContext, useContext } from 'react';

/** 五档动效：micro / standard / page / ritual / reduced */
export const EASE_STD = [0.2, 0, 0, 1] as const;
export const EASE_OUT = [0, 0, 0.2, 1] as const;

export const DUR = { micro: 0.12, std: 0.24, page: 0.34, ritual: 0.9 } as const;

export const SPRING = {
  sheet: { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 },
  snappy: { type: 'spring', stiffness: 520, damping: 34 },
  ritual: { type: 'spring', stiffness: 220, damping: 20, mass: 0.8 },
  soft: { type: 'spring', stiffness: 160, damping: 22 },
} as const;

export type MotionLevel = 'full' | 'lite' | 'off';

export interface MotionCtx {
  /** 生效后的等级（已考虑系统「减少动态效果」） */
  level: MotionLevel;
}

export const MotionContext = createContext<MotionCtx>({ level: 'full' });
export const useMotionLevel = () => useContext(MotionContext).level;

/** 按等级缩放时长：full 原样，lite 压到 ≤150ms，off 为 0 */
export function scaled(level: MotionLevel, seconds: number): number {
  if (level === 'off') return 0;
  if (level === 'lite') return Math.min(seconds, 0.15);
  return seconds;
}
