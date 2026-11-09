import Dexie, { type Table } from 'dexie';

export type RollStatus = 'stock' | 'loaded' | 'shot' | 'at-lab' | 'back' | 'archived';
export type FilmType = 'color-neg' | 'bw' | 'slide' | 'cine';
export type FilmFormat = '135' | '120' | '4x5' | '110';

export interface FilmStock {
  id: string;
  brand: string;
  name: string;
  iso: number;
  type: FilmType;
  formats: FilmFormat[];
  exposures?: number;
  discontinued: boolean;
  builtIn: boolean;
  boxPhotoId?: string;
  note?: string;
}

export interface HistoryItem {
  status: RollStatus;
  at: string;
}

export type NegCondition = 'good' | 'dusty' | 'scratched' | 'fungus';
export type NegScan = 'none' | 'lab' | 'self';

/** 底片保存记录（冲洗完的卷才有） */
export interface NegStorage {
  place?: string; // 例如「底片册 A」「防潮箱 2 层」
  slot?: string; // 例如「第 3 页」「第 12 格」
  condition?: NegCondition;
  scanned?: NegScan;
  scanNote?: string; // 扫描文件放在哪
}

export interface Roll {
  id: string;
  stockId: string;
  format: FilmFormat;
  status: RollStatus;
  keepSealed: boolean;
  expiry?: string; // YYYY-MM
  batchNo?: string;
  price?: number;
  boughtAt?: string; // YYYY-MM-DD
  boughtFrom?: string;
  locationId?: string;
  shotIso?: number;
  cameraId?: string;
  loadedAt?: string;
  unloadedAt?: string;
  /** 补录时没填拍摄日期：loadedAt 只是占位，不当作拍摄日期用 */
  dateUnknown?: boolean;
  framesShot?: number;
  labVisitId?: string;
  rating?: number;
  note?: string;
  neg?: NegStorage;
  history: HistoryItem[];
  createdAt: string;
  updatedAt: string;
}

/** 一张扫描件（电子版底片）。photoId 为查看用大图，thumbId 为缩略图。 */
export interface Frame {
  id: string;
  rollId: string;
  order: number; // 在这一卷里的顺序，显示张号 = order + 1
  photoId: string;
  thumbId: string;
  width: number;
  height: number;
  shutter?: string; // 例如 1/125
  aperture?: string; // 例如 f/2.8
  focal?: string; // 例如 50mm
  lens?: string; // 例如 Nikkor 50mm f/1.4
  place?: string;
  note?: string;
  /** 处理过时，导入时的原图（photoId 指向处理后的版本） */
  origPhotoId?: string;
  /** 除尘记录（清除了多少处）；还原原图时一并清除 */
  dust?: { healed: number; at: string };
  /** 上次使用的底片处理参数 */
  edit?: import('../lib/develop').DevParams;
  /** 导入时的原文件名与大小，用来避免同一文件重复导入 */
  srcName?: string;
  srcSize?: number;
  createdAt: string;
}

export interface Camera {
  id: string;
  name: string;
  format: FilmFormat;
  photoId?: string;
  retired: boolean;
  note?: string;
}

export interface Lab {
  id: string;
  name: string;
  note?: string;
}

export interface LabVisit {
  id: string;
  labId: string;
  rollIds: string[];
  sentAt: string;
  expectedAt?: string;
  backAt?: string;
  cost?: number;
  requests?: string;
}

export interface Location {
  id: string;
  name: string;
  order: number;
}

export interface Photo {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class FilmDB extends Dexie {
  stocks!: Table<FilmStock, string>;
  rolls!: Table<Roll, string>;
  cameras!: Table<Camera, string>;
  labs!: Table<Lab, string>;
  labVisits!: Table<LabVisit, string>;
  locations!: Table<Location, string>;
  photos!: Table<Photo, string>;
  frames!: Table<Frame, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'film-shelf') {
    super(name);
    this.version(1).stores({
      stocks: 'id, brand, type, discontinued',
      rolls: 'id, stockId, status, expiry, cameraId, labVisitId, locationId',
      cameras: 'id, retired',
      labs: 'id',
      labVisits: 'id, labId, sentAt, backAt',
      locations: 'id, order',
      photos: 'id',
      settings: 'key',
    });
    this.version(2).stores({ frames: 'id, rollId, order' });
  }
}

export const db = new FilmDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const nowIso = (): string => new Date().toISOString();
