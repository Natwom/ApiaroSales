const COLORS = { brand: '#2f8b99', green: '#22c55e', red: '#ef4444', amber: '#f59e0b', slate: '#94a3b8' }
export { COLORS }

export function Donut({ segments, size = 140, centerLabel }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = 48
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 120 120" className="shrink-0">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" className="dark:stroke-slate-800" />
        {total > 0 && segments.map((s) => {
          const len = (s.value / total) * c
          const el = (
            <circle key={s.label} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 60 60)">
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
        <text x="60" y="58" textAnchor="middle" className="fill-slate-900 dark:fill-slate-100" fontSize="20" fontWeight="700">{total}</text>
        <text x="60" y="73" textAnchor="middle" className="fill-slate-500" fontSize="9">{centerLabel}</text>
      </svg>
      <ul className="space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
            <span className="font-semibold">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TrendChart({ data, height = 190 }) {
  const W = 560, H = height, pl = 30, pr = 8, pt = 10, pb = 26
  const max = Math.max(1, ...data.flatMap((d) => [d.received, d.collected]))
  const nice = Math.ceil(max / 4) * 4 || 4
  const iw = W - pl - pr, ih = H - pt - pb
  const step = iw / Math.max(data.length, 1)
  const bw = Math.max(3, step * 0.32)
  const y = (v) => pt + ih - (v / nice) * ih
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nice * f))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Received and collected per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="#cbd5e1" strokeOpacity="0.5" strokeDasharray="3 3" />
            <text x={pl - 5} y={y(t) + 3} textAnchor="end" fontSize="9" className="fill-slate-500">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pl + i * step + step / 2
          return (
            <g key={d.date}>
              <rect x={x0 - bw - 1} y={y(d.received)} width={bw} height={Math.max(ih - (y(d.received) - pt), 0)} rx="2" fill={COLORS.green}>
                <title>{`${d.date} received: ${d.received}`}</title>
              </rect>
              <rect x={x0 + 1} y={y(d.collected)} width={bw} height={Math.max(ih - (y(d.collected) - pt), 0)} rx="2" fill={COLORS.red}>
                <title>{`${d.date} collected: ${d.collected}`}</title>
              </rect>
              {(i % 2 === 0 || data.length <= 8) && (
                <text x={x0} y={H - 8} textAnchor="middle" fontSize="9" className="fill-slate-500">
                  {new Date(d.date + 'T00:00:00').toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="flex gap-4 text-xs text-slate-500 mt-1">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.green }} /> Received</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.red }} /> Collected by customers</span>
      </div>
    </div>
  )
}

export function HBars({ rows, color = COLORS.brand, empty = 'Nothing to show yet.' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="truncate pr-2">{r.label}</span>
            <span className="font-semibold">{r.value}</span>
          </div>
          <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-2 rounded" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function StockBar({ value, total }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0
  const color = pct <= 15 ? COLORS.red : pct <= 40 ? COLORS.amber : COLORS.green
  return (
    <div className="w-28">
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-2 rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{pct}% of received</div>
    </div>
  )
}