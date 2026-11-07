/** 胶片走片式进度条：片孔随进度滚动；不传 value 时为循环滚动的“处理中”。 */
export function FilmProgress({ value }: { value?: number }) {
  const indet = value === undefined;
  return (
    <div className={`filmprog ${indet ? 'indet' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indet ? undefined : Math.round(value * 100)}>
      <div className="filmprog-fill" style={indet ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
      <div className="filmprog-holes" />
    </div>
  );
}
