import { useEffect, useState } from 'react';

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  speed?: number;
  message?: string;
}
interface Bridge {
  version(): Promise<string>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  openReleases(): Promise<void>;
  onState(cb: (s: UpdateState) => void): () => void;
}
const bridge = (): Bridge | undefined => (window as unknown as { filmshelfUpdater?: Bridge }).filmshelfUpdater;

/** 仅桌面版有；网页版 / PWA 返回 supported=false */
export function useUpdater() {
  const b = bridge();
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!b) return;
    b.version().then(setVersion).catch(() => {});
    return b.onState(setState);
  }, [b]);
  return {
    supported: !!b, state, version,
    check: () => b?.check(), download: () => b?.download(), install: () => b?.install(), openReleases: () => b?.openReleases(),
  };
}
