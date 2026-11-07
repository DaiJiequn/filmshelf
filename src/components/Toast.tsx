import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { scaled, SPRING, useMotionLevel } from '../motion/tokens';
import type { Undo } from '../db/actions';

interface ToastItem {
  id: number;
  text: string;
  undo?: Undo;
  tone?: 'ok' | 'error';
}

interface Ctx {
  show: (text: string, opts?: { undo?: Undo; tone?: 'ok' | 'error' }) => void;
}

const ToastContext = createContext<Ctx>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

/** 撤销提示：5 秒内可撤销 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const level = useMotionLevel();

  const show = useCallback<Ctx['show']>((text, opts) => {
    window.clearTimeout(timer.current);
    const id = ++seq.current;
    setItem({ id, text, undo: opts?.undo, tone: opts?.tone });
    timer.current = window.setTimeout(() => setItem((c) => (c?.id === id ? null : c)), opts?.undo ? 5000 : 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-layer" aria-live="polite">
        <AnimatePresence>
          {item && (
            <motion.div
              key={item.id}
              className={`toast ${item.tone === 'error' ? 'toast-error' : ''}`}
              initial={level === 'full' ? { y: 40, opacity: 0, scale: 0.96 } : { opacity: 0 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: level === 'full' ? 20 : 0 }}
              transition={level === 'full' ? SPRING.snappy : { duration: scaled(level, 0.15) }}
            >
              <span>{item.text}</span>
              {item.undo && (
                <button
                  className="toast-undo"
                  onClick={async () => {
                    const u = item.undo!;
                    setItem(null);
                    await u();
                  }}
                >
                  撤销
                </button>
              )}
              {item.undo && level !== 'off' && <span className="toast-bar" />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
