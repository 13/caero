import { Info } from 'lucide-react'
import { useSystemInfo } from '../../api/hooks'
import CaeroBrand from '../CaeroBrand'
import { APP_DESCRIPTION, APP_VERSION } from '../../constants/appInfo'

export default function AboutSection() {
  const { data: systemInfo } = useSystemInfo()

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 mt-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <Info className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </div>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">About</h2>
      </div>
      <div className="flex flex-col items-center gap-3 py-2">
        <CaeroBrand showText={false} logoAriaHidden={false} logoSizeClassName="h-16 w-16" className="justify-center mb-1" />
        <p className="text-sm text-gray-600 dark:text-gray-300 text-center mb-2">{APP_DESCRIPTION}</p>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl text-gray-700 dark:text-gray-200">
          <div className="text-right font-medium text-gray-500 hover:text-gray-700">Frontend Version:</div>
          <div className="font-mono">{APP_VERSION}</div>

          <div className="text-right font-medium text-gray-500 hover:text-gray-700">Backend Version:</div>
          <div className="font-mono">{systemInfo?.version || '...'}</div>

          <div className="text-right font-medium text-gray-500 hover:text-gray-700">Active Database:</div>
          <div className="font-mono">{systemInfo?.db_type || '...'}</div>

          <div className="text-right font-medium text-gray-500 hover:text-gray-700">DB Version:</div>
          <div className="font-mono">{systemInfo?.db_version || '...'}</div>

          <div className="text-right font-medium text-gray-500 hover:text-gray-700">Scraper Backend:</div>
          <div className="font-mono">{systemInfo?.scraper_backend || '...'}</div>

          <div className="text-right font-medium text-gray-500 hover:text-gray-700">Headless Mode:</div>
          <div className="font-mono">{systemInfo?.scraper_headless === false ? 'No' : 'Yes'}</div>
        </div>
      </div>
    </div>
  )
}
