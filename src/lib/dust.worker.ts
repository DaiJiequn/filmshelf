/// <reference lib="webworker" />
// 除尘后台线程。引擎：film-dust（MIT，magholmes/film-dust），见 vendor/film-dust/LICENSE.txt
import FilmDust from '../vendor/film-dust.bundle.js';

export interface DustJob { w: number; h: number; rgb: Uint16Array; polarity: 'auto' | 'white' | 'dark'; sensitivity: number; }
export interface DustMark { cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; kind: string; verdict: string; }
export type DustMsg =
  | { type: 'progress'; frac: number; text: string }
  | { type: 'done'; rgb: Uint16Array; healed: number; marks: DustMark[] }
  | { type: 'error'; message: string };

const post = (m: DustMsg, tr?: Transferable[]) => (self as unknown as Worker).postMessage(m, tr ?? []);

self.onmessage = async (ev: MessageEvent<DustJob>) => {
  const { w, h, rgb, polarity, sensitivity } = ev.data;
  try {
    const r = await FilmDust.cleanScan(rgb, w, h, 3, { polarity, sensitivity }, {
      progress: (frac: number, text: string) => post({ type: 'progress', frac, text }),
      tick: () => new Promise<void>((res) => setTimeout(res, 0)),
    });
    const marks: DustMark[] = (r.marks ?? []).map((m: Record<string, number | string>) => ({
      cx: +m.cx, cy: +m.cy, x0: +m.x0, y0: +m.y0, x1: +m.x1, y1: +m.y1, kind: String(m.kind ?? ''), verdict: String(m.verdict ?? ''),
    }));
    post({ type: 'done', rgb, healed: r.stats?.healed ?? 0, marks }, [rgb.buffer]);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
