import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { SPRING, useMotionLevel } from '../motion/tokens';

interface Props {
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const REVEAL = 88;

/** 左滑露出快捷操作；滑过一半松手触发。不支持拖拽时（动效关闭）不启用，操作走卡片内按钮。 */
export function SwipeAction({ actionLabel, onAction, disabled, children }: Props) {
  const level = useMotionLevel();
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-REVEAL, -20, 0], [1, 0.6, 0]);
  if (disabled || level === 'off') return <>{children}</>;
  return (
    <div className="swipe">
      <motion.button className="swipe-action" style={{ opacity }} onClick={onAction} tabIndex={-1}>
        {actionLabel}
      </motion.button>
      <motion.div
        className="swipe-front"
        style={{ x, touchAction: 'pan-y' }}
        drag="x"
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={0.12}
        onDragEnd={(_, info) => {
          if (info.offset.x < -REVEAL * 0.55 || info.velocity.x < -500) {
            animate(x, -REVEAL, SPRING.snappy);
          } else {
            animate(x, 0, SPRING.snappy);
          }
        }}
        onClickCapture={(e) => {
          if (x.get() < -4) {
            e.stopPropagation();
            e.preventDefault();
            animate(x, 0, SPRING.snappy);
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
