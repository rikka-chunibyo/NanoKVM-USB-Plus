import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

import { IpcEvents } from '../../common/ipc-events'

export type ScreenshotResult = {
  base64: string
  width: number
  height: number
  /** Path to a temporary PNG, replaced when the next screenshot succeeds. */
  path: string
}

type PendingCapture = {
  id: string
  window: BrowserWindow
  timer: NodeJS.Timeout
  resolve: (result: ScreenshotResult) => void
  reject: (error: Error) => void
}

let pending: PendingCapture | undefined
let getWindow: () => BrowserWindow | undefined
let lastTempFile: string | undefined

function cleanLastCapture(): void {
  if (!lastTempFile) return
  try {
    unlinkSync(lastTempFile)
  } catch {
    // The temporary file may have already been removed by the user.
  }
  lastTempFile = undefined
}

export function initCapture(getCurrentWindow: () => BrowserWindow | undefined): void {
  getWindow = getCurrentWindow
  app.once('will-quit', cleanLastCapture)

  ipcMain.on(
    IpcEvents.SCRIPT_SCREENSHOT_RESPONSE,
    (event, id: string, base64: string, width: number, height: number) => {
      const request = pending
      if (!request || id !== request.id || event.sender !== request.window.webContents) return
      clearTimeout(request.timer)
      pending = undefined

      if (!base64 || typeof base64 !== 'string' ||
          !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
        request.reject(new Error('No video frame is available'))
        return
      }
      try {
        const path = join(tmpdir(), 'kvm-screenshot-' + id + '.png')
        writeFileSync(path, Buffer.from(base64, 'base64'), { flag: 'wx', mode: 0o600 })
        cleanLastCapture()
        lastTempFile = path
        request.resolve({ base64, width, height, path })
      } catch (error) {
        request.reject(error as Error)
      }
    }
  )
}

export function captureScreen(timeoutMs = 3000): Promise<ScreenshotResult> {
  return new Promise((resolve, reject) => {
    const window = getWindow?.()
    if (!window || window.isDestroyed()) {
      reject(new Error('No renderer window available for screenshot'))
      return
    }
    if (pending) {
      reject(new Error('A screenshot is already in progress'))
      return
    }
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending = undefined
      reject(new Error('Screenshot timed out. Check that the video stream is active.'))
    }, timeoutMs)
    pending = { id, window, timer, resolve, reject }
    try {
      window.webContents.send(IpcEvents.SCRIPT_SCREENSHOT_REQUEST, id)
    } catch (error) {
      clearTimeout(timer)
      pending = undefined
      reject(error)
    }
  })
}
