import { APP_NAME } from '../constants/appInfo'

type CaeroBrandProps = {
  subtitle?: string
  className?: string
  logoAriaHidden?: boolean
  logoTitle?: string
}

export default function CaeroBrand({
  subtitle,
  className = '',
  logoAriaHidden = true,
  logoTitle = 'Caero logo',
}: CaeroBrandProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src="/caero.svg"
        aria-hidden={logoAriaHidden}
        alt={logoAriaHidden ? '' : logoTitle}
        className="h-7 w-7 rounded-md"
      />
      <div>
        <p className="font-bold text-gray-900 dark:text-gray-100 leading-tight">{APP_NAME}</p>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{subtitle}</p>}
      </div>
    </div>
  )
}
