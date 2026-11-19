import { X, Printer } from 'lucide-react'

export default function DetailPanel({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="print-area card w-full max-w-3xl mx-auto my-8 p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <div className="flex gap-2 no-print">
            <button className="btn-secondary" onClick={() => window.print()}>
              <Printer size={14} /> Print
            </button>
            <button className="btn-secondary" onClick={onClose}><X size={14} /></button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-medium mt-0.5">{children ?? '—'}</div>
    </div>
  )
}