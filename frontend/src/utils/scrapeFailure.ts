import type { CheckResult, ScrapeFailureReason } from '../api/types'
import { pluralize } from './format'

/** Backend default for SCRAPER_FAILURE_ALERT_THRESHOLD (older servers don't send it). */
export const DEFAULT_FAILURE_THRESHOLD = 3

/** none: all good. minor: a few failures, likely transient — mention quietly.
 *  broken: at/over the threshold the owner gets notified at — warn loudly. */
export type FailureSeverity = 'none' | 'minor' | 'broken'

export function failureSeverity(failures: number, threshold = DEFAULT_FAILURE_THRESHOLD): FailureSeverity {
  if (failures <= 0) return 'none'
  return failures >= threshold ? 'broken' : 'minor'
}

interface FailureCopy {
  /** Fits a narrow dashboard card. */
  short: string
  /** One or two sentences for the product page. */
  detail: string
  /** Whether editing the selector is the likely fix. */
  selectorFix: boolean
}

const REASONS: Record<ScrapeFailureReason, FailureCopy> = {
  no_match: {
    short: 'Selector matched nothing',
    detail: "The CSS selector found nothing on the page — the site's layout may have changed.",
    selectorFix: true,
  },
  unparseable: {
    short: "Selector text isn't a price",
    detail: "The CSS selector matched, but its text isn't a price. Point it at the price itself, or change the number format.",
    selectorFix: true,
  },
  unavailable: {
    short: 'Listed as unavailable',
    detail: "The shop lists this product as unavailable. Tracking picks up again once it's back.",
    selectorFix: false,
  },
  timeout: {
    short: 'Page took too long',
    detail: "The page didn't finish loading in time. This is often temporary.",
    selectorFix: false,
  },
  page_error: {
    short: "Page couldn't load",
    detail: 'The page failed to load — the shop may be down or blocking automated browsers.',
    selectorFix: false,
  },
}

const UNKNOWN: FailureCopy = {
  short: 'No price found',
  detail: "No price was found — the CSS selector may no longer match the site's layout.",
  selectorFix: true,
}

const DEGRADED: FailureCopy = {
  short: 'Scraping issue, not this product',
  detail: 'Checks are failing for many products right now — likely a network or browser problem, not this selector.',
  selectorFix: false,
}

/** Copy for a failure streak. `degraded` (scraping fails everywhere) overrides
 *  the per-product reason: the selector is then almost certainly not at fault. */
export function describeFailure(reason: string | null | undefined, degraded = false): FailureCopy {
  if (degraded) return DEGRADED
  return (reason && REASONS[reason as ScrapeFailureReason]) || UNKNOWN
}

/** Toast text for a manual check that found no price. */
export function checkFailureMessage(result: CheckResult): string {
  if (result.reason) {
    const { short } = describeFailure(result.reason)
    return `No price found: ${short.charAt(0).toLowerCase()}${short.slice(1)}`
  }
  return result.error ?? 'No price found'
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" — coarse on purpose. */
export function formatTimeAgo(value: string | null, now = Date.now()): string {
  if (!value) return ''
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} ${pluralize(days, 'day')} ago`
}
