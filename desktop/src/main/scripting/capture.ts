/**
 * capture.ts
 *
 * Handles screenshot requests from the script engine.
 * The video frame lives in the renderer; we ask for it over IPC,
 * receive base64 PNG back, and resolve the waiting promise.
 */

import { BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { IpcEvents } from '../../common/ipc-events'

let pendingResolve: ((result: ScreenshotResult) => void) | null = null
let pendingReject: ((err: Error) => void) | null = null
let captureWin: BrowserWindow | null = null

export type ScreenshotResult = {
  base64: string
  width: number
  height: number
  /** Path to a temp PNG file (auto-cleaned on next screenshot call) */
  path: string
}

let lastTempFile: string | null = null

export function initCapture(win: BrowserWindow): void {
  captureWin = win

  ipcMain.on(
    IpcEvents.SCRIPT_SCREENSHOT_RESPONSE,
    (_e, base64: string, width: number, height: number) => {
      if (!pendingResolve) return

      // Clean up previous temp file
      if (lastTempFile) {
        try { fs.unlinkSync(lastTempFile) } catch { /* ignore */ }
      }

      // Write to a temp PNG so Python / DSL scripts can use a file path
      const tmpPath = path.join(os.tmpdir(), `kvm-screenshot-${Date.now()}.png`)
      try {
        fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'))
        lastTempFile = tmpPath
      } catch (err) {
        pendingReject?.(err as Error)
        pendingResolve = null
        pendingReject = null
        return
      }

      pendingResolve({ base64, width, height, path: tmpPath })
      pendingResolve = null
      pendingReject = null
    }
  )
}

/**
 * Request a screenshot from the renderer.
 * Rejects if no window is available or if a capture is already in flight.
 */
export function captureScreen(timeoutMs = 3000): Promise<ScreenshotResult> {
  return new Promise((resolve, reject) => {
    if (!captureWin || captureWin.isDestroyed()) {
      return reject(new Error('No renderer window available for screenshot'))
    }
    if (pendingResolve) {
      return reject(new Error('A screenshot is already in progress'))
    }

    pendingResolve = resolve
    pendingReject = reject

    captureWin.webContents.send(IpcEvents.SCRIPT_SCREENSHOT_REQUEST)

    // Timeout guard
    setTimeout(() => {
      if (pendingResolve) {
        pendingResolve = null
        pendingReject = null
        reject(new Error('Screenshot timed out — is the video stream active?'))
      }
    }, timeoutMs)
  })
}
