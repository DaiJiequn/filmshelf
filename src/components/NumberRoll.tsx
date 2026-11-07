import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { scaled, SPRING, useMotionLevel } from '../motion/tokens';

/** 数字滚动：值变化时旧值上滑出、新值滑入（增加向上，减少向下） */
export function NumberRoll({ value, className = '' }: { value: number; className?: string }) {
  const level = useMotionLevel();
  const prev = useRef(value);
  const dir = value >= prev.current ? 1 : -1;
  prev.current = value;
  if (level === 'off') return <span className={`numroll ${className}`}>{value}</span>;
  const dist = level === 'lite' ? 0 : 14;
  return (
    <span className={`numroll ${className}`} style={{ display: 'inline-grid', overflow: 'hidden', verticalAlign: 'bottom' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          style={{ gridArea: '1 / 1', textAlign: 'center' }}
          initial={{ y: dir * dist, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -dir * dist, opacity: 0 }}
          transition={level === 'lite' ? { duration: scaled(level, 0.15) } : SPRING.snappy}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
