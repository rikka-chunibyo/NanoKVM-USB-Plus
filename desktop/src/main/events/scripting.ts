import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

import { IpcEvents } from '../../common/ipc-events'
import { device } from '../device'
import {
  ScriptEngine, ScriptType, detectScriptType,
  validateDsl, ScriptParseError,
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

function scriptPath(name: string, type: ScriptType): string {
  const safe = name.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim()
  return path.join(scriptsDir(), `${safe}${EXT[type]}`)
}

function findScript(name: string): { fullPath: string; type: ScriptType } | null {
  const safe = name.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim()
  for (const [type, ext] of Object.entries(EXT) as [ScriptType, string][]) {
    const p = path.join(scriptsDir(), `${safe}${ext}`)
    if (fs.existsSync(p)) return { fullPath: p, type }
  }
  return null
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
    const type = forceType ?? detectScriptType(source)
    if (type === 'js')     return validateJavaScript(source)
    if (type === 'python') return validatePython(source)
    return validateDsl(source)
  })

  // Storage
  ipcMain.handle(IpcEvents.SCRIPT_SAVE, (_: IpcMainInvokeEvent, name: string, source: string, type?: ScriptType) => {
    try {
      const resolved = type ?? detectScriptType(source)
      fs.writeFileSync(scriptPath(name, resolved), source, 'utf-8')
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  ipcMain.handle(IpcEvents.SCRIPT_LOAD, (_: IpcMainInvokeEvent, name: string) => {
    try {
      const found = findScript(name)
      if (!found) return { ok: false, error: `Script "${name}" not found` }
      return { ok: true, source: fs.readFileSync(found.fullPath, 'utf-8'), type: found.type }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  ipcMain.handle(IpcEvents.SCRIPT_DELETE, (_: IpcMainInvokeEvent, name: string) => {
    try {
      const found = findScript(name)
      if (!found) return { ok: false, error: `Script "${name}" not found` }
      fs.unlinkSync(found.fullPath)
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  ipcMain.handle(IpcEvents.SCRIPT_LIST, (): Array<{ name: string; type: ScriptType }> => {
    try {
      return fs.readdirSync(scriptsDir())
        .filter((f) => f.endsWith('.kvmscript') || f.endsWith('.js') || f.endsWith('.py'))
        .map((f) => {
          const type: ScriptType = f.endsWith('.js') ? 'js' : f.endsWith('.py') ? 'python' : 'dsl'
          return { name: f.replace(/\.(kvmscript|js|py)$/, ''), type }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch { return [] }
  })

  ipcMain.handle(IpcEvents.SCRIPT_SET_OPTIONS, (_: IpcMainInvokeEvent, opts: { typeDelay?: number; keyPressDelay?: number }) => {
    if (opts.typeDelay     !== undefined) engine.typeDelay     = opts.typeDelay
    if (opts.keyPressDelay !== undefined) engine.keyPressDelay = opts.keyPressDelay
  })
}
