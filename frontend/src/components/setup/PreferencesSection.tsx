import { User } from 'lucide-react'
import { useSaveUiSettings, useUiSettings } from '../../api/hooks'
import type { DateFormat, TimeFormat } from '../../api/types'
import { inputCls } from '../../utils/styles'
import Section from './Section'

export default function PreferencesSection({ showToast }: { showToast: (msg: string) => void }) {
  const { data: settings } = useUiSettings()
  const saveMutation = useSaveUiSettings()

  const dateFormat = settings?.date_format ?? 'DD.MM.YYYY'
  const timeFormat = settings?.time_format ?? '24h'
  const showSparklines = settings?.show_sparklines ?? true

  const save = (next: Partial<{ date_format: DateFormat; time_format: TimeFormat; show_sparklines: boolean }>) => {
    saveMutation.mutate(
      { date_format: dateFormat, time_format: timeFormat, show_sparklines: showSparklines, ...next },
      { onSuccess: () => showToast('Preferences saved.') }
    )
  }

  return (
    <Section icon={User} title="Preferences" description="Customize your experience">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date format</label>
          <select
            value={dateFormat}
            onChange={(e) => save({ date_format: e.target.value as DateFormat })}
            style={{ colorScheme: 'light dark' }}
            className={inputCls}
          >
            <option value="DD.MM.YYYY">DD.MM.YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Time format</label>
          <select
            value={timeFormat}
            onChange={(e) => save({ time_format: e.target.value as TimeFormat })}
            style={{ colorScheme: 'light dark' }}
            className={inputCls}
          >
            <option value="24h">24-hour (HH:MM)</option>
            <option value="12h">12-hour (HH:MM AM/PM)</option>
          </select>
        </div>

        <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Dashboard sparklines</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Show a mini price-trend chart on each product card</p>
          </div>
          <input
            type="checkbox"
            checked={showSparklines}
            onChange={(e) => save({ show_sparklines: e.target.checked })}
            className="rounded text-indigo-600 h-4 w-4"
          />
        </label>
      </div>
    </Section>
  )
}
