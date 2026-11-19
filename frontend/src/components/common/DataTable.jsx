import { useState } from 'react'

export default function DataTable({ columns, rows, rowKey = 'id', onRowClick, emptyMessage = 'No records found.' }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const sorted = [...(rows ?? [])].sort((a, b) => {
    if (!sortKey) return 0
    const av = a[sortKey], bv = b[sortKey]
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av ?? '').localeCompare(String(bv ?? ''))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-navy-800">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="th cursor-pointer select-none" onClick={() => c.sortable && toggleSort(c.key)}>
                  {c.header}{c.sortable && sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.length === 0 && (
              <tr><td colSpan={columns.length} className="td text-center py-10 text-slate-400">{emptyMessage}</td></tr>
            )}
            {sorted.map((row) => (
              <tr key={row[rowKey]}
                  className={onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}
                  onClick={() => onRowClick?.(row)}>
                {columns.map((c) => (
                  <td key={c.key} className="td">{c.render ? c.render(row) : row[c.key] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}