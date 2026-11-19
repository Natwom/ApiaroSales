const compact = (v) => {
  const n = Math.abs(v)
  if (n >= 1e6) return `${+(v / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${+(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

/**
 * data: [{ label, a, b }]   series: [{ key, label, color }]
 * The first series is drawn with a filled area, the others as lines.
 */
export default function AreaChart({ data, series, height = 230, format = compact }) {
  const W = 620, H = height, pl = 44, pr = 12, pt = 12, pb = 28
  const iw = W - pl - pr, ih = H - pt - pb
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0))))
  const mag = 10 ** Math.floor(Math.log10(max))
  const nice = Math.ceil(max / mag / 2) * mag * 2 || 1
  const x = (i) => pl + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw)
  const y = (v) => pt + ih - (v / nice) * ih
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => nice * f)

  const line = (key) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(d[key] ?? 0)).toFixed(1)}`).join(' ')
  const area = (key) =>
    data.length
      ? `${line(key)} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
      : ''

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="#cbd5e1" strokeOpacity="0.5" strokeDasharray="3 3" />
            <text x={pl - 6} y={y(t) + 3} textAnchor="end" fontSize="9" className="fill-slate-500">{format(t)}</text>
          </g>
        ))}
        {series[0] && <path d={area(series[0].key)} fill={series[0].color} fillOpacity="0.14" />}
        {series.map((s) => (
          <path key={s.key} d={line(s.key)} fill="none" stroke={s.color} strokeWidth="2.2"
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {data.map((d, i) => (
          <g key={d.label + i}>
            {series.map((s) => (
              <circle key={s.key} cx={x(i)} cy={y(Number(d[s.key] ?? 0))} r="3.2" fill="#fff" stroke={s.color} strokeWidth="2">
                <title>{`${d.label} — ${s.label}: ${Number(d[s.key] ?? 0).toLocaleString('en-KE')}`}</title>
              </circle>
            ))}
            <text x={x(i)} y={H - 9} textAnchor="middle" fontSize="9" className="fill-slate-500">{d.label}</text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 text-xs text-slate-500 mt-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}