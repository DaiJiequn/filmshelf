import type { Roll, RollStatus } from '../db/schema';

export const STATUS_ORDER: RollStatus[] = ['stock', 'loaded', 'shot', 'at-lab', 'back', 'archived'];

export const STATUS_LABEL: Record<RollStatus, string> = {
  stock: '库存',
  loaded: '在机',
  shot: '待冲',
  'at-lab': '在冲',
  back: '已取回',
  archived: '已归档',
};

/** 状态机：每个状态只能前进到下一个。回退通过「撤销」恢复快照，不走状态机。 */
export const NEXT_STATUS: Record<RollStatus, RollStatus | null> = {
  stock: 'loaded',
  loaded: 'shot',
  shot: 'at-lab',
  'at-lab': 'back',
  back: 'archived',
  archived: null,
};

export const PRIMARY_ACTION_LABEL: Record<RollStatus, string | null> = {
  stock: '上卷',
  loaded: '卸卷',
  shot: '送冲',
  'at-lab': '取回',
  back: '归档',
  archived: null,
};

export interface TransitionPatch {
  cameraId?: string;
  shotIso?: number;
  framesShot?: number;
  labVisitId?: string;
  rating?: number;
  note?: string;
  defaultIso?: number; // 品种 ISO，shotIso 缺省值
}

export class TransitionError extends Error {}

export function canTransition(roll: Pick<Roll, 'status' | 'keepSealed'>, to: RollStatus): boolean {
  if (NEXT_STATUS[roll.status] !== to) return false;
  if (roll.status === 'stock' && roll.keepSealed) return false; // 收藏卷需先取消封存
  return true;
}

/** 纯函数：返回转换后的新 Roll，非法转换抛 TransitionError。 */
export function transition(roll: Roll, to: RollStatus, patch: TransitionPatch, at: string): Roll {
  if (!canTransition(roll, to)) {
    throw new TransitionError(
      roll.keepSealed && roll.status === 'stock'
        ? '这卷被标为收藏封存，请先取消封存'
        : `不能从「${STATUS_LABEL[roll.status]}」变为「${STATUS_LABEL[to]}」`,
    );
  }
  const next: Roll = {
    ...roll,
    status: to,
    updatedAt: at,
    history: [...roll.history, { status: to, at }],
  };
  switch (to) {
    case 'loaded':
      if (!patch.cameraId) throw new TransitionError('上卷需要选择相机');
      next.cameraId = patch.cameraId;
      next.shotIso = patch.shotIso ?? patch.defaultIso;
      next.loadedAt = at;
      next.locationId = undefined;
      break;
    case 'shot':
      next.unloadedAt = at;
      if (patch.framesShot !== undefined) next.framesShot = patch.framesShot;
      break;
    case 'at-lab':
      if (!patch.labVisitId) throw new TransitionError('送冲需要冲洗店');
      next.labVisitId = patch.labVisitId;
      break;
    case 'archived':
      if (patch.rating !== undefined) next.rating = patch.rating;
      if (patch.note !== undefined) next.note = patch.note;
      break;
    default:
      break;
  }
  return next;
}
