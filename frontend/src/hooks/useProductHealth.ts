import { useScraperHealth, useUiSettings } from '../api/hooks'
import type { Product } from '../api/types'
import { describeFailure, failureSeverity, formatTimeAgo } from '../utils/scrapeFailure'

/** Everything the UI needs to warn about a product that isn't tracking right. */
export function useProductHealth(product: Product) {
  const { data: settings } = useUiSettings()
  const failures = product.consecutive_scrape_failures
  const severity = failureSeverity(failures, settings?.scrape_failure_threshold)
  const { data: health } = useScraperHealth(severity === 'broken')
  const failure = describeFailure(product.last_scrape_error, health?.scraping_degraded)
  const tooltip = [
    failure.detail,
    product.scrape_failing_since && `Failing since ${formatTimeAgo(product.scrape_failing_since)}.`,
  ].filter(Boolean).join(' ')
  return { failures, severity, failure, tooltip, redirected: product.url_redirected }
}
