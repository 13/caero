import { APP_NAME } from '../constants/appInfo'

type CaeroBrandProps = {
  subtitle?: string
  className?: string
}

export default function CaeroBrand({ subtitle, className = '' }: CaeroBrandProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <svg
        aria-hidden="true"
        viewBox="0 0 28 28"
        className="h-7 w-7 rounded-md"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="1" y="1" width="26" height="26" rx="7" fill="#4F46E5" />
        <path d="M18.8 9.7a6.5 6.5 0 1 0 0 8.6" stroke="#fff" strokeWidth="2.3" fill="none" />
      </svg>
      <div>
        <p className="font-bold text-gray-900 dark:text-gray-100 leading-tight">{APP_NAME}</p>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{subtitle}</p>}
      </div>
    </div>
  )
}
