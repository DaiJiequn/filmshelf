import { useCallback, useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet';

/** 应用内确认（不使用浏览器 confirm，避免被拦截且动效一致） */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; text: string; ok: string; danger?: boolean } | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback(
    (title: string, text: string, ok = '确认', danger = false) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState({ title, text, ok, danger });
      }),
    [],
  );

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  };

  const node = (
    <BottomSheet
      open={!!state}
      onClose={() => close(false)}
      title={state?.title ?? ''}
      footer={
        <div className="row-btns">
          <button className="btn ghost" onClick={() => close(false)}>取消</button>
          <button className={`btn ${state?.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>{state?.ok}</button>
        </div>
      }
    >
      <p className="confirm-text">{state?.text}</p>
    </BottomSheet>
  );
  return { confirm, node };
}
