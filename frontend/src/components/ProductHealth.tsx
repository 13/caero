import { ArrowRightLeft, TriangleAlert } from 'lucide-react'
import type { Product } from '../api/types'
import { useProductHealth } from '../hooks/useProductHealth'
import { pluralize } from '../utils/format'
import WarningBanner from './WarningBanner'

const REDIRECT_TOOLTIP = 'This link now points to a different product. Update the product URL.'

/** Dashboard card: redirect or failure notice, null when the product is fine.
 *  A redirect wins — scraping skips redirected products, so it is the real issue. */
export function ProductHealthNotice({ product, to }: { product: Product; to: string }) {
  const { failures, severity, failure, tooltip, redirected } = useProductHealth(product)
  if (redirected) {
    return (
      <WarningBanner variant="compact" tone="warning" icon={ArrowRightLeft} title="URL redirected"
        description="Update the product URL" tooltip={REDIRECT_TOOLTIP} to={to} />
    )
  }
  if (severity === 'none') return null
  return (
    <WarningBanner
      variant="compact"
      tone={severity === 'broken' ? 'error' : 'muted'}
      icon={TriangleAlert}
      title={failures === 1 ? 'Last check failed' : `${failures} failed ${pluralize(failures, 'check')}`}
      description={failure.short}
      tooltip={tooltip}
      to={to}
    />
  )
}

/** Table row: the same, as a pill. */
export function ProductHealthBadge({ product }: { product: Product }) {
  const { failures, severity, tooltip, redirected } = useProductHealth(product)
  if (redirected) {
    return <WarningBanner variant="badge" tone="warning" icon={ArrowRightLeft} title="Redirected" tooltip={REDIRECT_TOOLTIP} />
  }
  if (severity === 'none') return null
  return (
    <WarningBanner
      variant="badge"
      tone={severity === 'broken' ? 'error' : 'muted'}
      icon={TriangleAlert}
      title={`${failures} failed`}
      tooltip={tooltip}
    />
  )
}
