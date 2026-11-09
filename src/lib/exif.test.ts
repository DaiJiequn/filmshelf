import { describe, expect, it } from 'vitest';
import { injectExif, makeZip, parseRational } from './exif';

describe('exif', () => {
  it('parses rationals', () => {
    expect(parseRational('1/125')).toEqual([100, 12500]);
    expect(parseRational('f/2.8')).toEqual([280, 100]);
    expect(parseRational('50mm')).toEqual([5000, 100]);
    expect(parseRational('abc')).toBeNull();
  });
  it('injects an Exif APP1 after SOI/APP0 and drops old one', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2, 1, 2, 0xff, 0xd9]);
    const out = injectExif(jpg, { model: 'Nikon FM2', iso: 400, date: '2024-05-01', shutter: '1/125', aperture: 'f/2' });
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]);
    expect([out[2], out[3]]).toEqual([0xff, 0xe0]);
    expect([out[8], out[9]]).toEqual([0xff, 0xe1]);
    const again = injectExif(out, { model: 'X' });
    expect(again.filter((_, i) => again[i] === 0xff && again[i + 1] === 0xe1).length).toBe(1);
  });
  it('zips', async () => {
    const z = makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
    expect(z.size).toBeGreaterThan(40);
  });
});
