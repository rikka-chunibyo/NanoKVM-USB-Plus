import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

import { IpcEvents } from '../../common/ipc-events'
import { device } from '../device'
import {
  ScriptEngine, ScriptType,
  validateDsl,
} from '../scripting/engine'
import { validateJavaScript } from '../scripting/js-runner'
import { validatePython } from '../scripting/python-runner'
import { initCapture, captureScreen } from '../scripting/capture'

// ---------------------------------------------------------------------------
// Singleton engine — wired to the capture function
// ---------------------------------------------------------------------------
const engine = new ScriptEngine(device, captureScreen)

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function scriptsDir(): string {
  const dir = path.join(app.getPath('userData'), 'scripts')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const EXT: Record<ScriptType, string> = { dsl: '.kvmscript', js: '.js', python: '.py' }
const EXT_TO_TYPE: Record<string, ScriptType> = { '.kvmscript': 'dsl', '.js': 'js', '.py': 'python' }

/** Sanitise a single path segment (no slashes). */
function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim()
}

/**
 * Parse "folder/name" or just "name" from a user-supplied save name.
 * Returns { folder, base } where folder may be ''.
 */
function parseSaveName(name: string): { folder: string; base: string } {
  const slash = name.indexOf('/')
  if (slash === -1) return { folder: '', base: safeSeg(name) }
  return { folder: safeSeg(name.slice(0, slash)), base: safeSeg(name.slice(slash + 1)) }
}

/** Build a full path from display name + type, creating subdirs as needed. */
function scriptPath(name: string, type: ScriptType): string {
  const { folder, base } = parseSaveName(name)
  const dir = folder ? path.join(scriptsDir(), folder) : scriptsDir()
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${base}${EXT[type]}`)
}

/**
 * Resolve a filename that may include a folder prefix (e.g. "work/test.js")
 * to its absolute path + type.
 */
function resolveFilename(filename: string): { fullPath: string; type: ScriptType } | null {
  const ext = path.extname(filename)
  const type = EXT_TO_TYPE[ext]
  if (!type) return null
  const fullPath = path.join(scriptsDir(), filename)
  if (!fs.existsSync(fullPath)) return null
  return { fullPath, type }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export function registerScripting(win: BrowserWindow): void {
  initCapture(win)

  engine.on('progress', (p)   => win.webContents.send(IpcEvents.SCRIPT_PROGRESS, p))
  engine.on('error',    (err: Error) => win.webContents.send(IpcEvents.SCRIPT_ERROR, err.message))
  engine.on('log',      (msg: string) => win.webContents.send(IpcEvents.SCRIPT_LOG, msg))

  // Execution
  ipcMain.handle(IpcEvents.SCRIPT_RUN, async (_: IpcMainInvokeEvent, source: string, forceType?: ScriptType) => {
    if (engine.status === 'running' || engine.status === 'paused')
      return { ok: false, error: 'Already running' }
    engine.run(source, forceType).catch(console.error)
    return { ok: true }
  })

  ipcMain.handle(IpcEvents.SCRIPT_PAUSE,  async () => engine.pause())
  ipcMain.handle(IpcEvents.SCRIPT_RESUME, async () => engine.resume())
  ipcMain.handle(IpcEvents.SCRIPT_STOP,   async () => engine.stop())
  ipcMain.handle(IpcEvents.SCRIPT_STATUS, ()        => engine.status)

  // Validation
  ipcMain.handle(IpcEvents.SCRIPT_VALIDATE, (_: IpcMainInvokeEvent, source: string, forceType?: ScriptType) => {
    const type = forceType ?? 'dsl'
    if (type === 'js')     return validateJavaScript(source)
    if (type === 'python') return validatePython(source)
    return validateDsl(source)
  })

  // Storage
  ipcMain.handle(IpcEvents.SCRIPT_SAVE, (_: IpcMainInvokeEvent, name: string, source: string, type?: ScriptType) => {
    try {
      const resolved = type ?? 'dsl'
      fs.writeFileSync(scriptPath(name, resolved), source, 'utf-8')
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  ipcMain.handle(IpcEvents.SCRIPT_LOAD, (_: IpcMainInvokeEvent, filename: string) => {
    try {
      const found = resolveFilename(filename)
      if (!found) return { ok: false, error: `Script "${filename}" not found` }
      return { ok: true, source: fs.readFileSync(found.fullPath, 'utf-8'), type: found.type }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  ipcMain.handle(IpcEvents.SCRIPT_DELETE, (_: IpcMainInvokeEvent, filename: string) => {
    try {
      const found = resolveFilename(filename)
      if (!found) return { ok: false, error: `Script "${filename}" not found` }
      fs.unlinkSync(found.fullPath)
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  ipcMain.handle(IpcEvents.SCRIPT_LIST, (): Array<{ filename: string; displayName: string; type: ScriptType; folder: string }> => {
    try {
      const results: Array<{ filename: string; displayName: string; type: ScriptType; folder: string }> = []
      const root = scriptsDir()

      function walk(dir: string, folder: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), folder ? `${folder}/${entry.name}` : entry.name)
          } else {
            const ext = path.extname(entry.name)
            const type = EXT_TO_TYPE[ext]
            if (!type) continue
            const relativePath = folder ? `${folder}/${entry.name}` : entry.name
            results.push({
              filename: relativePath,
              displayName: entry.name.slice(0, -ext.length),
              type,
              folder,
            })
          }
        }
      }

      walk(root, '')
      return results.sort((a, b) =>
        a.folder.localeCompare(b.folder) || a.displayName.localeCompare(b.displayName)
      )
    } catch { return [] }
  })

  ipcMain.handle(IpcEvents.SCRIPT_SET_OPTIONS, (_: IpcMainInvokeEvent, opts: { typeDelay?: number; keyPressDelay?: number }) => {
    if (opts.typeDelay     !== undefined) engine.typeDelay     = opts.typeDelay
    if (opts.keyPressDelay !== undefined) engine.keyPressDelay = opts.keyPressDelay
  })
}