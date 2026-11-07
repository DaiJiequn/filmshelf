declare module 'utif';

declare module '*film-dust.bundle.js' {
  const FilmDust: {
    cleanScan: (img: Uint16Array, w: number, h: number, c: number, opts: Record<string, unknown>, hooks: Record<string, unknown>) => Promise<{ stats?: { healed?: number }; marks?: Record<string, number | string>[] }>;
    heal: (img: Uint16Array, w: number, h: number, c: number, mask: Uint8Array, outside: Uint8Array | null, onProgress?: (f: number) => void) => Promise<unknown>;
  };
  export default FilmDust;
}
