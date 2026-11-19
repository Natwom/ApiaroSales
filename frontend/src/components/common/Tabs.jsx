export default function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800 no-print">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
            value === t.key
              ? 'border-brand-500 text-brand-600 dark:text-brand-400 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}