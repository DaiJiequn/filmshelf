/** 先选好扫描件、再决定放进哪一卷：文件暂存在这里，进入「指定的那一卷」的扫描件页时取走 */
let pending: { files: File[]; rollId?: string } | null = null;
/** rollId 留空表示「等新建的那一卷」，新建完成后用 claimPendingImport 指定 */
export const setPendingImport = (files: File[], rollId?: string) => { pending = { files, rollId }; };
export const claimPendingImport = (rollId: string) => { if (pending && !pending.rollId) pending.rollId = rollId; };
export const takePendingImport = (rollId: string): File[] | null => {
  if (!pending || pending.rollId !== rollId) return null;
  const f = pending.files; pending = null; return f;
};
