import { motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { EASE_OUT, scaled, SPRING, useMotionLevel } from '../motion/tokens';

/** 居中弹层：遮罩淡入，面板从下方弹起；关闭时反向。需要父级用 AnimatePresence 包住才有退出动画。 */
export function Overlay({ label, onBackdrop, children }: { label: string; onBackdrop: () => void; children: React.ReactNode }) {
  const level = useMotionLevel();
  const d = scaled(level, 0.2);
  return createPortal(
    <motion.div className="ixp-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: d, ease: EASE_OUT }} onClick={onBackdrop}>
      <motion.div
        className="ixp" role="dialog" aria-modal="true" aria-label={label}
        initial={level === 'full' ? { y: 36, scale: 0.96, opacity: 0 } : { opacity: 0 }}
        animate={level === 'full' ? { y: 0, scale: 1, opacity: 1 } : { opacity: 1 }}
        exit={level === 'full' ? { y: 24, scale: 0.97, opacity: 0 } : { opacity: 0 }}
        transition={level === 'full' ? SPRING.sheet : { duration: d }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
