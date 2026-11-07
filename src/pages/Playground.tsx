import { Canister } from '../components/Canister';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { SEED_STOCKS } from '../db/seed-stocks';
import { useRitual, type RitualKind } from '../motion/signatures/Ritual';

const stock = SEED_STOCKS.find((s) => s.id === 'kodak-portra-400')!;
const stock2 = SEED_STOCKS.find((s) => s.id === 'ilford-hp5-plus-400')!;

/** 动效实验室：不动数据，单独回放每个招牌动效，方便调参 */
export default function Playground() {
  const ritual = useRitual();
  const toast = useToast();
  const items: { kind: RitualKind; label: string; data: Parameters<typeof ritual.play>[1] }[] = [
    { kind: 'load', label: '上卷', data: { stock, cameraName: 'Nikon FM2', remaining: 2 } },
    { kind: 'unload', label: '卸卷', data: { stock, cameraName: 'Nikon FM2' } },
    { kind: 'stockin', label: '入库 ×3', data: { stock: stock2, count: 3, total: 5 } },
    { kind: 'lab', label: '送冲 ×2', data: { stock, labName: '街角冲洗店', count: 2 } },
    { kind: 'back', label: '取回 ×2', data: { stock, count: 2 } },
    { kind: 'light', label: '图鉴点亮', data: { stock, litCount: 3, litTotal: SEED_STOCKS.length } },
  ];
  return (
    <div className="page">
      <PageHeader title="动效实验室" sub="点击回放；动画中轻触屏幕可跳过" back />
      <div className="lab-grid">
        {items.map((i) => (
          <button key={i.kind} className="btn ghost" onClick={() => ritual.play(i.kind, i.data)}>{i.label}</button>
        ))}
        <button className="btn ghost" onClick={() => toast.show('这是一条带撤销的提示', { undo: async () => toast.show('已撤销') })}>撤销提示</button>
      </div>
      <section className="section">
        <h2>罐体状态</h2>
        <div className="canister-row">
          <figure><Canister stock={stock} size={56} /><figcaption>正常</figcaption></figure>
          <figure><Canister stock={stock} size={56} expired /><figcaption>过期呼吸</figcaption></figure>
          <figure><Canister stock={stock} size={56} sealed /><figcaption>收藏封存</figcaption></figure>
          <figure><Canister stock={stock} size={56} unlit /><figcaption>未点亮</figcaption></figure>
        </div>
      </section>
    </div>
  );
}
