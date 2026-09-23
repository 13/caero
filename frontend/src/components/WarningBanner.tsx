import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

type Tone = 'muted' | 'warning' | 'error'

const toneCls: Record<Tone, { box: string; hover: string; icon: string; muted: string; button: string }> = {
  muted: {
    box: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/60 dark:text-gray-300 dark:border-gray-800',
    hover: 'hover:bg-gray-100 dark:hover:bg-gray-800/80',
    icon: 'text-gray-400 dark:text-gray-500',
    muted: 'text-gray-500 dark:text-gray-400',
    button: 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700',
  },
  warning: {
    box: 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800/50',
    hover: 'hover:bg-yellow-100 dark:hover:bg-yellow-900/50',
    icon: 'text-yellow-600 dark:text-yellow-400',
    muted: 'text-yellow-700/80 dark:text-yellow-300/80',
    button: 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/60 dark:hover:bg-yellow-900',
  },
  error: {
    box: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50',
    hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/50',
    icon: 'text-orange-600 dark:text-orange-400',
    muted: 'text-orange-700/80 dark:text-orange-300/80',
    button: 'bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/60 dark:hover:bg-orange-900',
  },
}

export interface BannerAction {
  label: string
  icon?: LucideIcon
  onClick: () => void
  disabled?: boolean
  /** Spins the icon (e.g. a check in flight). */
  busy?: boolean
}

/** Product health notice (failed checks, URL redirect). Compact = title and
 *  description only, optionally a link (dashboard card); full adds meta and actions. */
export default function WarningBanner({ tone, icon: Icon, title, description, meta, to, actions = [], compact = false, tooltip }: {
  tone: Tone
  icon: LucideIcon
  title: string
  description?: ReactNode
  meta?: ReactNode
  to?: string
  actions?: BannerAction[]
  compact?: boolean
  tooltip?: string
}) {
  const cls = toneCls[tone]

  if (compact) {
    // Description on its own line: cards are too narrow to share one with the
    // title, and truncating it ("— sel…") says nothing.
    const content = (
      <>
        <Icon className={`h-3.5 w-3.5 mt-px shrink-0 ${cls.icon}`} aria-hidden />
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          {description && <span className={`block ${cls.muted}`}>{description}</span>}
        </span>
      </>
    )
    const boxCls = `text-xs leading-snug px-3 py-2 rounded-lg border flex items-start gap-2 ${cls.box}`
    return to ? (
      <Link to={to} title={tooltip} className={`${boxCls} ${cls.hover} transition-colors`}>{content}</Link>
    ) : (
      <div title={tooltip} className={boxCls}>{content}</div>
    )
  }

  return (
    <div className={`mt-3 text-sm px-3 py-2.5 rounded-lg border flex flex-wrap items-center gap-x-4 gap-y-2 sm:max-w-max ${cls.box}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cls.icon}`} aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{title}</p>
          {description && <p className={`text-xs mt-0.5 ${cls.muted}`}>{description}</p>}
          {meta && <p className={`text-xs mt-0.5 ${cls.muted}`}>{meta}</p>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="ml-6.5 sm:ml-0 flex flex-wrap gap-2">
          {actions.map(({ label, icon: ActionIcon, onClick, disabled, busy }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              disabled={disabled}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs font-medium rounded-md disabled:opacity-50 transition-colors ${cls.button}`}
            >
              {ActionIcon && <ActionIcon className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden />}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
