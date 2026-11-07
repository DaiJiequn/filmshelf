import { db, type FilmFormat, type FilmStock, type FilmType } from './schema';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function s(
  brand: string,
  name: string,
  iso: number,
  type: FilmType,
  formats: FilmFormat[],
  discontinued = false,
): FilmStock {
  return { id: slug(`${brand} ${name}`), brand, name, iso, type, formats, discontinued, builtIn: true };
}

const C: FilmType = 'color-neg';
const B: FilmType = 'bw';
const S: FilmType = 'slide';
const V: FilmType = 'cine';

export const SEED_STOCKS: FilmStock[] = [
  // Kodak
  s('Kodak', 'Gold 200', 200, C, ['135']),
  s('Kodak', 'ColorPlus 200', 200, C, ['135']),
  s('Kodak', 'UltraMax 400', 400, C, ['135']),
  s('Kodak', 'Portra 160', 160, C, ['135', '120', '4x5']),
  s('Kodak', 'Portra 400', 400, C, ['135', '120', '4x5']),
  s('Kodak', 'Portra 800', 800, C, ['135', '120']),
  s('Kodak', 'Ektar 100', 100, C, ['135', '120', '4x5']),
  s('Kodak', 'Ektachrome E100', 100, S, ['135', '120', '4x5']),
  s('Kodak', 'Tri-X 400', 400, B, ['135', '120', '4x5']),
  s('Kodak', 'T-Max 100', 100, B, ['135', '120', '4x5']),
  s('Kodak', 'T-Max 400', 400, B, ['135', '120', '4x5']),
  s('Kodak', 'Vision3 50D', 50, V, ['135']),
  s('Kodak', 'Vision3 250D', 250, V, ['135']),
  s('Kodak', 'Vision3 500T', 500, V, ['135']),
  s('Kodak', 'Ektachrome 100VS', 100, S, ['135', '120'], true),
  s('Kodak', 'Portra 400NC', 400, C, ['135', '120'], true),
  // Fujifilm
  s('Fujifilm', 'C200', 200, C, ['135']),
  s('Fujifilm', 'Superia X-tra 400', 400, C, ['135']),
  s('Fujifilm', 'Velvia 50', 50, S, ['135', '120', '4x5']),
  s('Fujifilm', 'Velvia 100', 100, S, ['135', '120', '4x5']),
  s('Fujifilm', 'Provia 100F', 100, S, ['120', '4x5']),
  s('Fujifilm', 'Neopan Acros 100 II', 100, B, ['135', '120']),
  s('Fujifilm', 'Pro 400H', 400, C, ['135', '120'], true),
  s('Fujifilm', 'Superia Premium 400', 400, C, ['135'], true),
  s('Fujifilm', 'Neopan 400 Presto', 400, B, ['135'], true),
  // Ilford / Harman
  s('Ilford', 'HP5 Plus 400', 400, B, ['135', '120', '4x5']),
  s('Ilford', 'FP4 Plus 125', 125, B, ['135', '120', '4x5']),
  s('Ilford', 'Delta 100', 100, B, ['135', '120', '4x5']),
  s('Ilford', 'Delta 400', 400, B, ['135', '120']),
  s('Ilford', 'Delta 3200', 3200, B, ['135', '120']),
  s('Ilford', 'Pan F Plus 50', 50, B, ['135', '120']),
  s('Ilford', 'XP2 Super 400', 400, B, ['135', '120']),
  s('Ilford', 'SFX 200', 200, B, ['135', '120']),
  s('Kentmere', 'Pan 100', 100, B, ['135', '120']),
  s('Kentmere', 'Pan 400', 400, B, ['135', '120']),
  // Cinestill
  s('CineStill', '50D', 50, V, ['135', '120']),
  s('CineStill', '800T', 800, V, ['135', '120']),
  s('CineStill', '400D', 400, V, ['135', '120']),
  s('CineStill', 'BwXX', 250, B, ['135']),
  // Lomography
  s('Lomography', 'Color Negative 100', 100, C, ['135', '120']),
  s('Lomography', 'Color Negative 400', 400, C, ['135', '120']),
  s('Lomography', 'Color Negative 800', 800, C, ['135', '120']),
  s('Lomography', 'LomoChrome Purple', 400, C, ['135', '120']),
  s('Lomography', 'LomoChrome Metropolis', 400, C, ['135', '120']),
  s('Lomography', 'LomoChrome Turquoise', 400, S, ['135']),
  s('Lomography', 'Redscale XR 50-200', 200, C, ['135', '120']),
  s('Lomography', 'Berlin Kino 400', 400, B, ['135']),
  // Others
  s('Fomapan', '100 Classic', 100, B, ['135', '120', '4x5']),
  s('Fomapan', '200 Creative', 200, B, ['135', '120']),
  s('Fomapan', '400 Action', 400, B, ['135', '120', '4x5']),
  s('Rollei', 'Retro 80S', 80, B, ['135', '120']),
  s('Rollei', 'Retro 400S', 400, B, ['135', '120']),
  s('Rollei', 'RPX 100', 100, B, ['135', '120']),
  s('Rollei', 'RPX 400', 400, B, ['135', '120']),
  s('Adox', 'CHS 100 II', 100, B, ['135', '120', '4x5']),
  s('Shanghai', 'GP3 100', 100, B, ['135', '120']),
  s('Lucky', 'SHD 100', 100, B, ['135', '120']),
  s('Agfa', 'Vista 200', 200, C, ['135'], true),
  s('Agfa', 'APX 100', 100, B, ['135', '120'], true),
  s('Konica', 'Centuria 400', 400, C, ['135'], true),
];

/** 首次运行或版本更新时补齐内置品种（不会覆盖用户已改的数据）。 */
export async function seedIfNeeded(): Promise<number> {
  const existing = new Set(await db.stocks.toCollection().primaryKeys());
  const missing = SEED_STOCKS.filter((x) => !existing.has(x.id));
  if (missing.length) await db.stocks.bulkAdd(missing);
  return missing.length;
}
