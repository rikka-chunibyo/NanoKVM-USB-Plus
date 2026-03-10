/**
 * components/settings/files.tsx
 *
 * Settings tab for configuring where screenshots, videos, and scripts are saved.
 * Each row shows the current path (or "Downloads" if unset) with a Browse button
 * that opens a native directory picker.
 */

import { ReactElement, useEffect, useState } from 'react'
import { Divider } from 'antd'
import { CameraIcon, FolderIcon, FolderOpenIcon, RotateCcwIcon, VideoIcon, FileCodeIcon } from 'lucide-react'

import { IpcEvents } from '@common/ipc-events'
import {
  getScreenshotSavePath, setScreenshotSavePath,
  getVideoSavePath, setVideoSavePath,
  getScriptSavePath, setScriptSavePath,
} from '@renderer/libs/storage'

type PathRowProps = {
  icon: ReactElement
  label: string
  description: string
  value: string
  onChange: (path: string) => void
}

const PathRow = ({ icon, label, description, value, onChange }: PathRowProps): ReactElement => {
  async function browse(): Promise<void> {
    const chosen = await window.electron.ipcRenderer.invoke(IpcEvents.OPEN_DIR_PICKER)
    if (chosen) onChange(chosen)
  }

  function reset(): void {
    onChange('')
  }

  return (
    <div className="flex flex-col gap-2 py-4 border-b border-neutral-800 last:border-0">
      <div className="flex items-center gap-2">
        <span className="text-neutral-400">{icon}</span>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-neutral-500">{description}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-6">
        {/* Path display */}
        <div className="flex flex-1 items-center gap-2 rounded border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-xs">
          <FolderIcon size={12} className="shrink-0 text-neutral-500" />
          <span className={value ? 'text-neutral-200 truncate' : 'text-neutral-600 italic'}>
            {value || 'Downloads (default)'}
          </span>
        </div>

        {/* Browse */}
        <button
          onClick={browse}
          className="flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white transition-colors"
        >
          <FolderOpenIcon size={12} />
          Browse
        </button>

        {/* Reset to default */}
        {value && (
          <button
            onClick={reset}
            title="Reset to default (Downloads)"
            className="flex items-center justify-center rounded border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <RotateCcwIcon size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

export const Files = (): ReactElement => {
  const [screenshotPath, setScreenshotPath] = useState('')
  const [videoPath, setVideoPath]           = useState('')
  const [scriptPath, setScriptPath]         = useState('')

  useEffect(() => {
    setScreenshotPath(getScreenshotSavePath())
    setVideoPath(getVideoSavePath())
    setScriptPath(getScriptSavePath())
  }, [])

  function handleScreenshotChange(p: string): void {
    setScreenshotPath(p)
    setScreenshotSavePath(p)
  }
  function handleVideoChange(p: string): void {
    setVideoPath(p)
    setVideoSavePath(p)
  }
  function handleScriptChange(p: string): void {
    setScriptPath(p)
    setScriptSavePath(p)
  }

  return (
    <>
      <div className="text-base font-bold">Save Locations</div>
      <Divider />

      <p className="mb-4 text-sm text-neutral-400">
        Choose where screenshots, recordings, and scripts are saved by default.
        Hold <kbd className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs text-neutral-200">Shift</kbd> while
        clicking the screenshot or record button to choose a specific location each time.
      </p>

      <PathRow
        icon={<CameraIcon size={16} />}
        label="Screenshots"
        description="PNG files saved by the screenshot button"
        value={screenshotPath}
        onChange={handleScreenshotChange}
      />
      <PathRow
        icon={<VideoIcon size={16} />}
        label="Recordings"
        description="WebM files saved by the record button"
        value={videoPath}
        onChange={handleVideoChange}
      />
      <PathRow
        icon={<FileCodeIcon size={16} />}
        label="Scripts"
        description="Where scripts are stored on disk"
        value={scriptPath}
        onChange={handleScriptChange}
      />
    </>
  )
}
