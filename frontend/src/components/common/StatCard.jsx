export default function StatCard({ title, value, icon: Icon, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <div className="card p-5 flex items-center gap-4">
      {Icon && (
        <div className={`rounded-lg p-3 ${tones[tone]}`}>
          <Icon size={22} />
        </div>
      )}
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{title}</p>
        <p className="text-xl font-semibold mt-0.5">{value}</p>
      </div>
    </div>
  )
}