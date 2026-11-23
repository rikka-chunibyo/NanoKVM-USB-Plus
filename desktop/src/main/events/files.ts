/**
 * main/events/files.ts
 *
 * Handles all file-saving IPC from the renderer.
 *
 * IPC events used (add to ipc-events.ts):
 *   GET_DOWNLOADS_DIR       → returns app.getPath('downloads')
 *   OPEN_DIR_PICKER         → shows dialog.showOpenDialog for a directory
 *   SAVE_SCREENSHOT         → writes a base64 PNG to disk, returns { ok, path }
 *   OPEN_SAVE_DIALOG        → shows dialog.showSaveDialog, returns chosen path or null
 *   OPEN_VIDEO_WRITE_STREAM → opens an fs write stream, returns streamId
 *   WRITE_VIDEO_CHUNK       → appends a base64 chunk to an open stream
 *   CLOSE_VIDEO_WRITE_STREAM→ closes the stream, returns { ok, path }
 */

import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import { IpcEvents } from '../../common/ipc-events'

// Active write streams for video recording: streamId → WriteStream
const writeStreams = new Map<string, { stream: fs.WriteStream; path: string }>()
let streamCounter = 0

export function registerFiles(): void {
  // ── GET_DOWNLOADS_DIR ───────────────────────────────────────────────────
  ipcMain.handle(IpcEvents.GET_DOWNLOADS_DIR, () => {
    return app.getPath('downloads')
  })

  // ── OPEN_DIR_PICKER ─────────────────────────────────────────────────────
  ipcMain.handle(IpcEvents.OPEN_DIR_PICKER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose save folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── SAVE_SCREENSHOT ─────────────────────────────────────────────────────
  // payload: { base64: string, dir: string, filename: string }
  // dir may be '' → use downloads
  ipcMain.handle(IpcEvents.SAVE_SCREENSHOT, async (_, payload: {
    base64: string
    dir: string
    filename: string
  }) => {
    try {
      if (!payload.filename || path.basename(payload.filename) !== payload.filename ||
          path.extname(payload.filename).toLowerCase() !== '.png') {
        return { ok: false, error: 'Invalid screenshot file name' }
      }
      const dir = payload.dir || app.getPath('downloads')
      fs.mkdirSync(dir, { recursive: true })
      const fullPath = path.join(dir, payload.filename)
      const buf = Buffer.from(payload.base64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      fs.writeFileSync(fullPath, buf)
      return { ok: true, path: fullPath }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  // ── OPEN_SAVE_DIALOG ────────────────────────────────────────────────────
  // Shows Electron save dialog. Returns chosen path string or null.
  ipcMain.handle(IpcEvents.OPEN_SAVE_DIALOG, async (event, payload: {
    defaultPath: string
    filters: { name: string; extensions: string[] }[]
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: payload.defaultPath,
      filters: payload.filters,
    })
    return result.canceled ? null : result.filePath
  })

  // ── OPEN_VIDEO_WRITE_STREAM ─────────────────────────────────────────────
  ipcMain.handle(IpcEvents.OPEN_VIDEO_WRITE_STREAM, async (_, filePath: string) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const stream = fs.createWriteStream(filePath)
      const id = String(++streamCounter)
      stream.on('error', () => writeStreams.delete(id))
      await once(stream, 'open')
      writeStreams.set(id, { stream, path: filePath })
      return { ok: true, streamId: id }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle(IpcEvents.WRITE_VIDEO_CHUNK, async (_, streamId: string, base64: string) => {
    const entry = writeStreams.get(streamId)
    if (!entry) return { ok: false, error: 'Stream not found' }
    try {
      const buffer = Buffer.from(base64, 'base64')
      await new Promise<void>((resolve, reject) => {
        entry.stream.write(buffer, (error) => error ? reject(error) : resolve())
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle(IpcEvents.CLOSE_VIDEO_WRITE_STREAM, async (_, streamId: string) => {
    const entry = writeStreams.get(streamId)
    if (!entry) return { ok: false, error: 'Stream not found' }
    writeStreams.delete(streamId)
    try {
      const completion = finished(entry.stream, { cleanup: true })
      entry.stream.end()
      await completion
      return { ok: true, path: entry.path }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
}
