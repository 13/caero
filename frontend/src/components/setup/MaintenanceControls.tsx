import { useState } from 'react'
import { useSaveSettings } from '../../api/hooks'
import type { AppSettings, AppSettingsPatch, TimeFormat } from '../../api/types'
import { inputCls, labelCls } from '../../utils/styles'
import TimePicker from '../TimePicker'

export type MaintenanceKey = 'backup' | 'retention'
type Knob = 'backup_keep' | 'price_history_thin_after_days' | 'event_log_retention_days'

const KNOBS: Record<MaintenanceKey, { field: Knob; label: string; env: string }[]> = {
  backup: [{ field: 'backup_keep', label: 'Backups to keep', env: 'BACKUP_KEEP' }],
  retention: [
    { field: 'price_history_thin_after_days', label: 'Thin prices after (days)', env: 'PRICE_HISTORY_THIN_AFTER_DAYS' },
    { field: 'event_log_retention_days', label: 'Keep log events (days)', env: 'EVENT_LOG_RETENTION_DAYS' },
  ],
}

/** Inline on/off, run time and keep knobs of one nightly maintenance job. */
export default function MaintenanceControls({ jobKey, name, settings, timeFormat, showToast }: {
  jobKey: MaintenanceKey
  name: string
  settings: AppSettings
  timeFormat?: TimeFormat
  showToast: (msg: string) => void
}) {
  const save = useSaveSettings()
  // Show a toggle in flight right away instead of after the round trip.
  const pendingEnabled = save.isPending ? save.variables?.[`${jobKey}_enabled`] : undefined
  const enabled = pendingEnabled ?? settings[`${jobKey}_enabled`]
  const storedTime = settings[`${jobKey}_time`]
  // null = untouched, show the stored value. Knob drafts: '' = use the env value.
  const [timeDraft, setTimeDraft] = useState<string | null>(null)
  const [knobDrafts, setKnobDrafts] = useState<Partial<Record<Knob, string>>>({})

  const patch: AppSettingsPatch = {}
  if (timeDraft !== null && timeDraft !== storedTime) patch[`${jobKey}_time`] = timeDraft
  for (const { field } of KNOBS[jobKey]) {
    const draft = knobDrafts[field]
    if (draft === undefined) continue
    const value = draft.trim() === '' ? null : Number(draft)
    if (value !== settings[field]) patch[field] = value
  }
  const knobsValid = KNOBS[jobKey].every(({ field }) => {
    const draft = knobDrafts[field]?.trim()
    return !draft || (Number.isInteger(Number(draft)) && Number(draft) >= 0)
  })
  const dirty = Object.keys(patch).length > 0

  const submit = (body: AppSettingsPatch, message: string, onSuccess?: () => void) =>
    save.mutate(body, {
      onSuccess: () => { onSuccess?.(); showToast(message) },
      onError: (err: Error) => showToast(err.message || 'Could not save'),
    })

  return (
    <div className="mt-2 sm:ml-5 flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer pb-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={save.isPending}
          onChange={(e) => submit({ [`${jobKey}_enabled`]: e.target.checked }, `${name} ${e.target.checked ? 'enabled' : 'disabled'}.`)}
          className="rounded text-indigo-600 h-4 w-4"
          aria-label={`Enable ${name}`}
        />
        Enabled
      </label>
      <div>
        <span className={labelCls}>Time</span>
        <TimePicker
          value={timeDraft ?? storedTime}
          onChange={setTimeDraft}
          format={timeFormat ?? '24h'}
          className={`${inputCls} w-auto`}
        />
      </div>
      {KNOBS[jobKey].map(({ field, label, env }) => (
        <div key={field} className="w-40">
          <label className={labelCls} htmlFor={`knob-${field}`}>{label}</label>
          <input
            id={`knob-${field}`}
            type="number"
            min={0}
            step={1}
            value={knobDrafts[field] ?? (settings[field] === null ? '' : String(settings[field]))}
            onChange={(e) => setKnobDrafts((d) => ({ ...d, [field]: e.target.value }))}
            placeholder={`env ${settings[`${field}_env`]}`}
            title={`0 = off. Empty = ${env} from .env (${settings[`${field}_env`]}).`}
            className={inputCls}
          />
        </div>
      ))}
      <button
        type="button"
        disabled={save.isPending || !dirty || !knobsValid}
        onClick={() => submit(patch, `${name} settings saved.`, () => { setTimeDraft(null); setKnobDrafts({}) })}
        className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        Save
      </button>
      <p className="basis-full text-xs text-gray-500 dark:text-gray-400">
        0 turns that part off; leave empty to use the .env value.
      </p>
    </div>
  )
}
