import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { useMotionLevel } from '../motion/tokens';

type VT = { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> } };

/**
 * 带共享元素转场的跳转：
 * 给起点元素临时打上 view-transition-name: shared，目标页的同名元素会被浏览器自动补间（位置+尺寸）。
 * 不支持 View Transitions 或动效为「简化/关闭」时，直接跳转。
 */
export function useGo() {
  const navigate = useNavigate();
  const level = useMotionLevel();
  return useCallback(
    (to: string, shared?: HTMLElement) => {
      const doc = document as Document & VT;
      if (level !== 'full' || !doc.startViewTransition) {
        navigate(to);
        return;
      }
      if (shared) shared.style.viewTransitionName = 'shared';
      const t = doc.startViewTransition(() => {
        flushSync(() => navigate(to));
      });
      t.finished.finally(() => {
        if (shared) shared.style.viewTransitionName = '';
      });
    },
    [navigate, level],
  );
}

export function useBack() {
  const navigate = useNavigate();
  return useCallback(() => (window.history.length > 1 ? navigate(-1) : navigate('/')), [navigate]);
}
