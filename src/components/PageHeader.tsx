import { useBack } from '../lib/nav';

export function PageHeader({ title, sub, back, right }: { title: string; sub?: string; back?: boolean; right?: React.ReactNode }) {
  const goBack = useBack();
  return (
    <header className="page-head">
      {back && (
        <button className="icon-btn" onClick={goBack} aria-label="返回">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <div className="page-head-title">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </header>
  );
}
