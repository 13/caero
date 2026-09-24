import { Clock, Loader2, Play, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useJobs, useMe, useRunJob, useUiSettings } from '../../api/hooks'
import type { JobOut, JobStatus, TimeFormat } from '../../api/types'
import { formatDateTime, formatDuration, formatRelativeTime, formatRunTime } from '../../utils/format'
import Section from './Section'

const STATUS: Record<JobStatus | 'never', { dot: string; label: string }> = {
  ok: { dot: 'bg-green-500', label: 'Last run OK' },
  failed: { dot: 'bg-red-500', label: 'Last run failed' },
  skipped: { dot: 'bg-amber-500', label: 'Last run skipped' },
  never: { dot: 'bg-gray-300 dark:bg-gray-600', label: 'Not run yet' },
}

function JobRow({ job, linkable, dateFormat, timeFormat, busy, onRun }: {
  job: JobOut
  linkable: boolean
  dateFormat?: string
  timeFormat?: TimeFormat
  busy: boolean
  onRun: () => void
}) {
  const status = STATUS[job.last_status ?? 'never']
  const nameCls = 'font-medium text-sm truncate'
  return (
    <li className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${status.dot}`} title={status.label} aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {linkable && job.product_id ? (
              <Link to={`/products/${job.product_id}`} className={`${nameCls} text-indigo-600 dark:text-indigo-400 hover:underline`}>
                {job.name}
              </Link>
            ) : (
              <span className={`${nameCls} text-gray-900 dark:text-gray-100`}>{job.name}</span>
            )}
            <span className="sr-only">{status.label}</span>
            {job.consecutive_failures > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                {job.consecutive_failures} failed in a row
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {job.schedule}{job.owner ? ` · ${job.owner}` : ''}
          </p>
          {job.last_status === 'failed' && job.last_message && (
            <p className="text-xs text-red-600 dark:text-red-400 truncate">{job.last_message}</p>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs sm:w-64 shrink-0 text-gray-700 dark:text-gray-300">
        <dt className="text-gray-500 dark:text-gray-400">Next</dt>
        <dd title={formatDateTime(job.next_run_time, dateFormat)}>
          {job.next_run_time
            ? `${formatRelativeTime(job.next_run_time)} · ${formatRunTime(job.next_run_time, dateFormat, timeFormat)}`
            : 'paused'}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">Last</dt>
        <dd title={formatDateTime(job.last_run_at, dateFormat)}>
          {formatRelativeTime(job.last_run_at)}
          {job.last_run_at ? ` · ${formatRunTime(job.last_run_at, dateFormat, timeFormat)}` : ''}
          {job.last_duration_ms != null ? ` · ${formatDuration(job.last_duration_ms)}` : ''}
        </dd>
      </dl>
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        aria-label={`Run ${job.name} now`}
        className="self-start sm:self-center shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        Run now
      </button>
    </li>
  )
}

export default function SchedulersTab({ showToast }: { showToast: (msg: string) => void }) {
  const { data, isLoading, error } = useJobs()
  const { data: me } = useMe()
  const { data: uiSettings } = useUiSettings()
  const runJob = useRunJob()

  const jobs = data?.jobs ?? []
  const productJobs = jobs.filter((j) => j.kind === 'product')
  const maintenanceJobs = jobs.filter((j) => j.kind === 'maintenance')
  const failing = productJobs.filter((j) => j.last_status === 'failed').length

  const run = (job: JobOut) =>
    runJob.mutate(job.id, {
      onSuccess: () => showToast(`Queued: ${job.name}`),
      onError: (err) =>
        showToast(err instanceof ApiError && err.status === 404 ? 'Job no longer exists' : err.message || 'Could not start the job'),
    })

  const renderRows = (list: JobOut[]) => (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {list.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          linkable={!!me && job.owner === me.username}
          dateFormat={uiSettings?.date_format}
          timeFormat={uiSettings?.time_format}
          busy={job.running || (runJob.isPending && runJob.variables === job.id)}
          onRun={() => run(job)}
        />
      ))}
    </ul>
  )

  const summary = [
    `${productJobs.length} scheduled`,
    `${failing} failing`,
    ...(data?.check_all_running ? ['Check all running'] : []),
  ].join(' · ')

  return (
    <div className="space-y-4">
      <Section icon={Clock} title="Scrape jobs" description={`${summary} · refreshes every 30s`}>
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
        ) : productJobs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No products are scheduled. Inactive products and products with checks disabled have no job.
          </p>
        ) : (
          renderRows(productJobs)
        )}
      </Section>
      {maintenanceJobs.length > 0 && (
        <Section icon={Wrench} title="Maintenance" description="Nightly backup and retention">
          {renderRows(maintenanceJobs)}
        </Section>
      )}
    </div>
  )
}
