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
  framesShot?: number;
  labVisitId?: string;
  rating?: number;
  note?: string;
  history: HistoryItem[];
  createdAt: string;
  updatedAt: string;
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
  }
}

export const db = new FilmDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const nowIso = (): string => new Date().toISOString();
