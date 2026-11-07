import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { scaled, SPRING, useMotionLevel } from '../motion/tokens';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** 底部弹层：弹簧进入，向下拖拽超过阈值关闭，Esc 关闭 */
export function BottomSheet({ open, onClose, title, children, footer }: Props) {
  const level = useMotionLevel();
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const sheetAnim =
    level === 'full'
      ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: SPRING.sheet }
      : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: scaled(level, 0.15) } };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="sheet-root" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: scaled(level, 0.2) }}
            onClick={onClose}
          />
          <motion.div
            className="sheet"
            {...sheetAnim}
            drag={level === 'full' ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
            dragListener={false}
            dragControls={controls}
          >
            <div className="sheet-grip" onPointerDown={(e) => controls.start(e)} />
            <div className="sheet-head" onPointerDown={(e) => (e.target as HTMLElement).closest('button') ? null : controls.start(e)}>
              <h2>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
            </div>
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
