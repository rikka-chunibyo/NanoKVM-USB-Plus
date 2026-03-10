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

import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'

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
    const win = require('electron').BrowserWindow.fromWebContents(event.sender)
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
      const dir = payload.dir || app.getPath('downloads')
      fs.mkdirSync(dir, { recursive: true })
      const fullPath = path.join(dir, payload.filename)
      const buf = Buffer.from(payload.base64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      fs.writeFileSync(fullPath, buf)
      return { ok: true, path: fullPath }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  // ── OPEN_SAVE_DIALOG ────────────────────────────────────────────────────
  // Shows Electron save dialog. Returns chosen path string or null.
  ipcMain.handle(IpcEvents.OPEN_SAVE_DIALOG, async (event, payload: {
    defaultPath: string
    filters: { name: string; extensions: string[] }[]
  }) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: payload.defaultPath,
      filters: payload.filters,
    })
    return result.canceled ? null : result.filePath
  })

  // ── OPEN_VIDEO_WRITE_STREAM ─────────────────────────────────────────────
  ipcMain.handle(IpcEvents.OPEN_VIDEO_WRITE_STREAM, (_, filePath: string) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const stream = fs.createWriteStream(filePath)
      const id = String(++streamCounter)
      writeStreams.set(id, { stream, path: filePath })
      return { ok: true, streamId: id }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  // ── WRITE_VIDEO_CHUNK ───────────────────────────────────────────────────
  ipcMain.handle(IpcEvents.WRITE_VIDEO_CHUNK, async (_, streamId: string, base64: string) => {
    const entry = writeStreams.get(streamId)
    if (!entry) return { ok: false, error: 'Stream not found' }
    const buf = Buffer.from(base64, 'base64')
    await new Promise<void>((resolve, reject) => {
      entry.stream.write(buf, (err) => err ? reject(err) : resolve())
    })
    return { ok: true }
  })

  // ── CLOSE_VIDEO_WRITE_STREAM ────────────────────────────────────────────
  ipcMain.handle(IpcEvents.CLOSE_VIDEO_WRITE_STREAM, async (_, streamId: string) => {
    const entry = writeStreams.get(streamId)
    if (!entry) return { ok: false, error: 'Stream not found' }
    await new Promise<void>((resolve) => entry.stream.end(resolve))
    writeStreams.delete(streamId)
    return { ok: true, path: entry.path }
  })
}
