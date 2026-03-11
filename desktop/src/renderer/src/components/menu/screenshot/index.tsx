import { ReactElement, useState } from 'react'
import { Tooltip } from 'antd'
import clsx from 'clsx'
import { CameraIcon, CheckIcon } from 'lucide-react'

import { IpcEvents } from '@common/ipc-events'
import { getScreenshotSavePath } from '@renderer/libs/storage'

type State = 'idle' | 'saving' | 'done' | 'error'

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
}

function captureVideo(): string | null {
  const video = document.getElementById('video') as HTMLVideoElement | null
  if (!video || !video.videoWidth) return null

  const canvas = document.createElement('canvas')
  canvas.width  = video.videoWidth
  canvas.height = video.videoHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL('image/png')
}

export const Screenshot = (): ReactElement => {
  const [state, setState] = useState<State>('idle')

  async function handleClick(e: React.MouseEvent): Promise<void> {
    if (state === 'saving') return

    const base64 = captureVideo()
    if (!base64) return

    setState('saving')

    try {
      const filename = `screenshot-${timestamp()}.png`

      if (e.shiftKey) {
        const downloadsDir = await window.electron.ipcRenderer.invoke(IpcEvents.GET_DOWNLOADS_DIR)
        const defaultPath = `${downloadsDir}/${filename}`

        const chosenPath = await window.electron.ipcRenderer.invoke(IpcEvents.OPEN_SAVE_DIALOG, {
          defaultPath,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        })

        if (!chosenPath) { setState('idle'); return }

        const parts = chosenPath.replace(/\\/g, '/').split('/')
        const chosenFile = parts.pop()!
        const chosenDir  = parts.join('/')

        await window.electron.ipcRenderer.invoke(IpcEvents.SAVE_SCREENSHOT, {
          base64,
          dir: chosenDir,
          filename: chosenFile,
        })
      } else {
        const dir = getScreenshotSavePath()
        await window.electron.ipcRenderer.invoke(IpcEvents.SAVE_SCREENSHOT, {
          base64,
          dir,
          filename,
        })
      }

      setState('done')
      setTimeout(() => setState('idle'), 1500)
    } catch (err) {
      console.error('Screenshot failed', err)
      setState('error')
      setTimeout(() => setState('idle'), 2000)
    }
  }

  const tooltipTitle = (
    <span>
      Screenshot&nbsp;
      <span className="text-neutral-400 text-xs">Shift+click to choose location</span>
    </span>
  )

  return (
    <Tooltip title={tooltipTitle} placement="bottom" overlayStyle={{ maxWidth: 260 }}>
      <div
        className={clsx(
          'flex h-[28px] cursor-pointer items-center justify-center rounded px-2 hover:bg-neutral-700/70',
          state === 'done'  && 'text-green-400',
          state === 'error' && 'text-red-400',
          state === 'idle' || state === 'saving' ? 'text-white' : '',
        )}
        onClick={handleClick}
      >
        {state === 'done'
          ? <CheckIcon size={18} />
          : <CameraIcon size={18} className={clsx(state === 'saving' && 'opacity-50')} />
        }
      </div>
    </Tooltip>
  )
}