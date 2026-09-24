export interface User {
  id: number
  username: string
  is_admin: boolean
  default_email: string | null
  default_telegram_chat_id: string | null
  starred_product_ids: number[]
  created_at: string
}

export interface Token {
  access_token: string
  token_type: string
}

/** Number-format hint for parsing scraped prices. */
export type PriceFormat = 'auto' | 'eu' | 'us'

export interface Product {
  id: number
  user_id: number
  name: string
  category: string | null
  memo: string | null
  tags: string[]
  image_url: string | null
  cached_image_url?: string | null
  check_time_hhmm?: string | null
  url: string
  selector: string
  check_interval_minutes: number
  record_all_prices: boolean
  price_format: PriceFormat
  inverse_price: boolean
  consecutive_scrape_failures: number
  /** Why the latest failed check found no price; null while checks succeed */
  last_scrape_error: ScrapeFailureReason | null
  /** When the current failure streak began */
  scrape_failing_since: string | null
  url_redirected: boolean
  active: boolean
  currency: string
  latest_price: string | null
  previous_price: string | null
  last_price_change_percent: string | null
  last_price_change_at: string | null
  next_run_at: string | null
  last_checked_at: string | null
  lowest_price: string | null
  lowest_price_at: string | null
  highest_price: string | null
  highest_price_at: string | null
  created_at: string
}

export interface ProductCreate {
  name: string
  category?: string | null
  memo?: string | null
  tags?: string[]
  image_url?: string | null
  check_time_hhmm?: string | null
  url: string
  selector: string
  check_interval_minutes?: number
  record_all_prices?: boolean
  price_format?: PriceFormat
  inverse_price?: boolean
  active?: boolean
}

export interface ProductUpdate {
  name?: string
  category?: string | null
  memo?: string | null
  tags?: string[]
  image_url?: string | null
  check_time_hhmm?: string | null
  url?: string
  selector?: string
  check_interval_minutes?: number
  record_all_prices?: boolean
  price_format?: PriceFormat
  inverse_price?: boolean
  active?: boolean
}

export interface PriceHistory {
  id: number
  product_id: number
  price: string
  currency: string
  scraped_at: string
}

export interface PriceHistoryCreate {
  price: string
  scraped_at: string
  currency?: string | null
}

export type AlertCondition = 'below' | 'changed' | 'any_change' | 'lowered' | 'lowered_percent'

export interface Alert {
  id: number
  product_id: number
  condition: AlertCondition
  threshold_price: string | null
  threshold_percent?: string | null
  email: string | null
  telegram_chat_id: string | null
  active: boolean
  last_checked_at?: string | null
  last_triggered_at?: string | null
}

export interface AlertCreate {
  condition: AlertCondition
  threshold_price?: string | null
  threshold_percent?: string | null
  email?: string | null
  telegram_chat_id?: string | null
  active?: boolean
}

export type DateFormat = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
export type TimeFormat = '12h' | '24h'

export interface AppSettings {
  allow_registration: boolean
  date_format: DateFormat
  time_format: TimeFormat
  telegram_bot_token_set: boolean
  /** Admin-set base URL for "Open in Caero" links ('' = use the env var). */
  public_url: string
  /** PUBLIC_URL env fallback. */
  public_url_env: string
  updated_at: string | null
}

export interface AppSettingsIn {
  allow_registration: boolean
  date_format: DateFormat
  time_format: TimeFormat
  /** undefined/null = keep stored token, '' = clear it */
  telegram_bot_token?: string | null
  /** undefined/null = keep, '' = clear (fall back to PUBLIC_URL) */
  public_url?: string | null
}

export interface NotificationChannelStatus {
  channel: string
  last_success_at: string | null
  last_failure_at: string | null
  last_error: string | null
  consecutive_failures: number
}

export type ChartLineStyle = 'curved' | 'straight' | 'stepped'

export interface UiSettings {
  date_format: DateFormat
  time_format: TimeFormat
  show_sparklines: boolean
  chart_line_style: ChartLineStyle
  /** Failed checks in a row before a product counts as broken; read-only */
  scrape_failure_threshold?: number
}

export interface SparklinePoint {
  t: string
  p: string
}

export interface SelectorDefault {
  id: number
  domain: string
  selector: string
}

export interface SelectorDefaultIn {
  domain: string
  selector: string
}

export interface TestEmailRequest {
  email: string
}

export interface TestTelegramRequest {
  chat_id: string
}

export interface TestNotificationResponse {
  status: 'sent' | 'error'
  message: string
}

export interface CheckResult {
  product_id: number
  price: string | null
  error: string | null
  reason?: ScrapeFailureReason | null
}

export type ScrapeFailureReason = 'no_match' | 'unparseable' | 'unavailable' | 'timeout' | 'page_error'

/** /api/health — the parts the UI reads */
export interface HealthOut {
  scraping_degraded: boolean
  last_successful_scrape_at: string | null
}

export interface ProductStatistics {
  average_price: string | null
  lowest_price: string | null
  lowest_price_at: string | null
  highest_price: string | null
  highest_price_at: string | null
  current_price: string | null
  total_change_percent: string | null
  last_change_percent: string | null
  last_change_at: string | null
  data_points: number
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface AdminUserCreate {
  username: string
  password: string
  is_admin?: boolean
}

export interface AdminUserPasswordUpdate {
  new_password: string
}

export interface NotificationDefaultsUpdate {
  default_email?: string | null
  default_telegram_chat_id?: string | null
}

export interface DataExportPayload {
  app_settings: Record<string, unknown>
  users: Record<string, unknown>[]
  products: Record<string, unknown>[]
  price_history: Record<string, unknown>[]
  alerts: Record<string, unknown>[]
}

export interface UserDataExportPayload {
  products: Record<string, unknown>[]
  price_history: Record<string, unknown>[]
  alerts: Record<string, unknown>[]
}
export interface SystemInfoOut {
  version: string
  /** ISO-8601 image build time; empty when not running a built image. */
  build_date: string
  db_type: string
  db_version: string
  scraper_backend: string
  scraper_headless: boolean
}

export type JobStatus = 'ok' | 'failed' | 'skipped'

export interface JobOut {
  id: string
  kind: 'product' | 'maintenance'
  name: string
  product_id: number | null
  owner: string | null
  schedule: string
  next_run_time: string | null
  last_run_at: string | null
  last_status: JobStatus | null
  last_duration_ms: number | null
  last_message: string | null
  consecutive_failures: number
  running: boolean
}

export interface JobsResponse {
  jobs: JobOut[]
  check_all_running: boolean
}

export type EventLevel = 'info' | 'warning' | 'error'
export type EventCategory = 'scrape' | 'alert' | 'notification' | 'system' | 'maintenance'

export interface EventLogEntry {
  id: number
  created_at: string
  level: EventLevel
  category: EventCategory
  event: string
  product_id: number | null
  product_name: string | null
  message: string
  duration_ms: number | null
  details: Record<string, unknown> | null
}

export interface EventLogPage {
  items: EventLogEntry[]
  next_before_id: number | null
}