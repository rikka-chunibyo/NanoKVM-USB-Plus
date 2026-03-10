/**
 * components/script/capture.tsx
 *
 * Invisible component. Listens for screenshot requests from the main process,
 * grabs the current video frame via canvas, and sends the base64 PNG back.
 */

import { useEffect } from 'react'
import { IpcEvents } from '@common/ipc-events'

export const ScriptCapture = (): null => {
  useEffect(() => {
    const rm = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_SCREENSHOT_REQUEST, () => {
      const video = document.getElementById('video') as HTMLVideoElement | null

      if (!video || !video.videoWidth) {
        window.electron.ipcRenderer.send(
          IpcEvents.SCRIPT_SCREENSHOT_RESPONSE,
          '',  // empty base64 signals failure
          0, 0
        )
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      // Strip the data: URL prefix to get raw base64
      const base64 = canvas.toDataURL('image/png').split(',')[1]
      window.electron.ipcRenderer.send(
        IpcEvents.SCRIPT_SCREENSHOT_RESPONSE,
        base64,
        canvas.width,
        canvas.height
      )
    })

    return rm
  }, [])

  return null
}
