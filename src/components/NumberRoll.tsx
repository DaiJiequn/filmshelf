import { animate, AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
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

/** 数字计数：首次出现时从 0 数到目标值，之后变化时平滑过渡（仅「完整」动效） */
export function CountUp({ value }: { value: number }) {
  const level = useMotionLevel();
  const [shown, setShown] = useState(level === 'full' ? 0 : value);
  const from = useRef(level === 'full' ? 0 : value);
  useEffect(() => {
    if (level !== 'full') { setShown(value); from.current = value; return; }
    const c = animate(from.current, value, {
      duration: Math.min(0.9, 0.3 + Math.abs(value - from.current) * 0.06),
      ease: [0.2, 0, 0, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    from.current = value;
    return () => c.stop();
  }, [value, level]);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{shown}</span>;
}
