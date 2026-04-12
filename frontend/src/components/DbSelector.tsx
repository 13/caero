import type { AppSettings } from '../api/types'

interface DbSelectorProps {
  value: AppSettings
  onChange: (settings: AppSettings) => void
}

export default function DbSelector({ value, onChange }: DbSelectorProps) {
  const isPostgres = value.db_type === 'postgresql'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* SQLite card */}
        <button
          type="button"
          onClick={() => onChange({ ...value, db_type: 'sqlite' })}
          className={`relative rounded-xl border-2 p-4 text-left transition-colors ${
            !isPostgres
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          {!isPostgres && (
            <span className="absolute top-2 right-2 text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 px-2 py-0.5 rounded-full font-medium">
              default
            </span>
          )}
          <p className="font-semibold text-gray-900 dark:text-gray-100">SQLite</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Simple file-based database, perfect for homelab</p>
        </button>

        {/* PostgreSQL card */}
        <button
          type="button"
          onClick={() => onChange({ ...value, db_type: 'postgresql' })}
          className={`rounded-xl border-2 p-4 text-left transition-colors ${
            isPostgres
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <p className="font-semibold text-gray-900 dark:text-gray-100">PostgreSQL</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Full-featured database for multi-user setups</p>
        </button>
      </div>

      {/* SQLite config */}
      {!isPostgres && (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              SQLite file path
            </label>
          <input
            type="text"
            value={value.sqlite_path}
            onChange={(e) => onChange({ ...value, sqlite_path: e.target.value })}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Mount a Docker volume at <code>/data</code> to persist the database between container restarts.
          </p>
        </div>
      )}

      {/* PostgreSQL config */}
      {isPostgres && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Host</label>
            <input
              type="text"
              value={value.pg_host}
              onChange={(e) => onChange({ ...value, pg_host: e.target.value })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
            <input
              type="number"
              value={value.pg_port}
              onChange={(e) => onChange({ ...value, pg_port: parseInt(e.target.value) || 5432 })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Database</label>
            <input
              type="text"
              value={value.pg_database}
              onChange={(e) => onChange({ ...value, pg_database: e.target.value })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input
              type="text"
              value={value.pg_user}
              onChange={(e) => onChange({ ...value, pg_user: e.target.value })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={value.pg_password}
              onChange={(e) => onChange({ ...value, pg_password: e.target.value })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}
    </div>
  )
}
