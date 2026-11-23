import { useEffect } from 'react'
import { IpcEvents } from '@common/ipc-events'

export const ScriptCapture = (): null => {
  useEffect(() => {
    return window.electron.ipcRenderer.on(IpcEvents.SCRIPT_SCREENSHOT_REQUEST, (_, id: string) => {
      let base64 = ''
      let width = 0
      let height = 0

      try {
        const video = document.getElementById('video')
        if (video instanceof HTMLVideoElement && video.videoWidth && video.videoHeight) {
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const context = canvas.getContext('2d')
          if (context) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            base64 = canvas.toDataURL('image/png').split(',')[1] ?? ''
            width = canvas.width
            height = canvas.height
          }
        }
      } catch {
        // An unavailable frame is reported through the same response below.
      } finally {
        window.electron.ipcRenderer.send(IpcEvents.SCRIPT_SCREENSHOT_RESPONSE, id, base64, width, height)
      }
    })
  }, [])

  return null
}
