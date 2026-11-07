import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { Canister } from '../components/Canister';
import { useConfirm } from '../components/Confirm';
import { PageHeader } from '../components/PageHeader';
import { useSheets } from '../components/SheetHost';
import { useToast } from '../components/Toast';
import { Empty, PhotoInput } from '../components/ui';
import { deleteStock, updateRoll } from '../db/actions';
import { db } from '../db/schema';
import { STATUS_LABEL } from '../domain/roll-state';
import { fmtDate, fmtMoney, FORMAT_LABEL, usePhotoUrl, useSettings } from '../lib/hooks';
import { savePhoto, TYPE_LABEL } from '../lib/image';
import { useGo } from '../lib/nav';

void updateRoll;

export default function StockDetail() {
  const { id = '' } = useParams();
  const sheets = useSheets();
  const toast = useToast();
  const navigate = useNavigate();
  const go = useGo();
  const [settings] = useSettings();
  const { confirm, node } = useConfirm();
  const data = useLiveQuery(async () => {
    const stock = await db.stocks.get(id);
    const rolls = stock ? await db.rolls.where('stockId').equals(id).toArray() : [];
    return { stock, rolls };
  }, [id]);
  const photo = usePhotoUrl(data?.stock?.boxPhotoId);

  if (!data) return <div className="page" />;
  const { stock, rolls } = data;
  if (!stock) {
    return (
      <div className="page"><PageHeader title="找不到品种" back /><Empty title="这个品种不存在" /></div>
    );
  }
  const archived = rolls.filter((r) => r.status === 'archived');
  const lit = archived.length > 0;
  const counts = rolls.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const priced = rolls.filter((r) => r.price !== undefined).sort((a, b) => (a.boughtAt ?? a.createdAt).localeCompare(b.boughtAt ?? b.createdAt));
  const rated = archived.filter((r) => r.rating);
  const avgRating = rated.length ? rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length : undefined;

  return (
    <div className="page grain detail">
      <PageHeader title={stock.name} sub={`${stock.brand} · ISO ${stock.iso} · ${TYPE_LABEL[stock.type]}`} back />
      <div className="hero">
        <div className="hero-glow" />
        <Canister stock={stock} size={92} unlit={!lit} style={{ viewTransitionName: 'shared' } as React.CSSProperties} />
        <div className="hero-status">
          {stock.discontinued && <span className="badge">已停产</span>}
          <span className="badge">{stock.formats.map((f) => FORMAT_LABEL[f]).join(' / ')}</span>
          <span className={`status-pill ${lit ? 's-archived' : ''}`}>{lit ? `已点亮 · 拍过 ${archived.length} 卷` : '未点亮'}</span>
        </div>
      </div>

      <div className="row-btns">
        <button className="btn primary" onClick={() => sheets.openInStock(stock.id)}>入库这个品种</button>
        <button className="btn ghost" onClick={() => sheets.openStockForm(stock.id)}>编辑</button>
      </div>

      {photo ? (
        <section className="section">
          <h2>包装照片</h2>
          <img className="box-photo" src={photo} alt={`${stock.name} 包装`} />
        </section>
      ) : null}
      <div className="detail-tools">
        <PhotoInput onFile={async (f) => {
          const pid = await savePhoto(f, stock.boxPhotoId);
          await db.stocks.update(stock.id, { boxPhotoId: pid });
        }}>{photo ? '更换包装照片' : '添加包装照片'}</PhotoInput>
      </div>

      <section className="section">
        <h2>我的记录</h2>
        {rolls.length === 0 ? (
          <p className="muted">还没有这个品种的胶卷。</p>
        ) : (
          <div className="kv">
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).filter((s) => counts[s]).map((s) => (
              <div key={s} className="kv-row"><span className="muted">{STATUS_LABEL[s]}</span><span>{counts[s]} 卷</span></div>
            ))}
            {avgRating !== undefined && <div className="kv-row"><span className="muted">平均评分</span><span>{avgRating.toFixed(1)} ★</span></div>}
          </div>
        )}
      </section>

      {priced.length > 0 && (
        <section className="section">
          <h2>价格记录</h2>
          <div className="kv">
            {priced.slice(-8).reverse().map((r) => (
              <div key={r.id} className="kv-row">
                <span className="muted">{fmtDate(r.boughtAt ?? r.createdAt)}{r.boughtFrom ? ` · ${r.boughtFrom}` : ''}</span>
                <span>{fmtMoney(r.price, settings.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="section">
          <h2>拍过的卷</h2>
          <div className="list">
            {archived.map((r) => (
              <button key={r.id} className="card row-card" onClick={() => go(`/roll/${r.id}`)}>
                <div className="grow">
                  <strong>{fmtDate(r.loadedAt ?? r.createdAt)}</strong>
                  <div className="muted small">{r.note ?? FORMAT_LABEL[r.format]}</div>
                </div>
                <span className="stars-inline">{'★'.repeat(r.rating ?? 0)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!stock.builtIn && (
        <div className="detail-tools">
          <button
            className="btn ghost danger-text"
            onClick={async () => {
              if (!(await confirm('删除这个品种？', `「${stock.brand} ${stock.name}」将从图鉴中移除。`, '删除', true))) return;
              try {
                await deleteStock(stock.id);
                navigate(-1);
              } catch (e) {
                toast.show((e as Error).message, { tone: 'error' });
              }
            }}
          >
            删除品种
          </button>
        </div>
      )}
      {node}
    </div>
  );
}
