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

/** Configurable save directory; null = fall back to userData/scripts */
let configuredScriptsDir: string | null = null

/** Path to the small JSON file that persists the configured scripts dir. */
function scriptConfigPath(): string {
  return path.join(app.getPath('userData'), 'kvm-script-config.json')
}

/** Load configured dir from disk once at module initialisation time. */
function loadScriptConfig(): void {
  try {
    const raw = fs.readFileSync(scriptConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { saveDir?: string }
    configuredScriptsDir = parsed.saveDir || null
  } catch { /* file not found or invalid — use default */ }
}

function saveScriptConfig(): void {
  try {
    fs.writeFileSync(scriptConfigPath(), JSON.stringify({ saveDir: configuredScriptsDir }), 'utf-8')
  } catch { /* non-fatal */ }
}

loadScriptConfig()

function scriptsDir(): string {
  const dir = configuredScriptsDir || path.join(app.getPath('userData'), 'scripts')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const EXT: Record<ScriptType, string> = { dsl: '.kvm', js: '.js', python: '.py' }
const EXT_TO_TYPE: Record<string, ScriptType> = { '.kvm': 'dsl', '.js': 'js', '.py': 'python' }

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

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '' && !path.isAbsolute(relative) &&
    relative !== '..' && !relative.startsWith('..' + path.sep)
}

/** Build a save path inside the configured scripts directory. */
function scriptPath(name: string, type: ScriptType): string {
  const { folder, base } = parseSaveName(name)
  if (!base || !Object.hasOwn(EXT, type)) throw new Error('Invalid script name or type')
  const root = fs.realpathSync(scriptsDir())
  const dir = folder ? path.join(root, folder) : root
  fs.mkdirSync(dir, { recursive: true })
  const fullPath = path.join(fs.realpathSync(dir), base + EXT[type])
  if (!isInside(root, fullPath) || fs.lstatSync(fullPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Invalid script path')
  }
  return fullPath
}

/** Resolve only regular script files under the configured directory. */
function resolveFilename(filename: string): { fullPath: string; type: ScriptType } | null {
  const ext = path.extname(filename)
  if (path.isAbsolute(filename) || !Object.hasOwn(EXT_TO_TYPE, ext)) return null
  const root = fs.realpathSync(scriptsDir())
  const fullPath = path.resolve(root, filename)
  if (!isInside(root, fullPath) || !fs.lstatSync(fullPath, { throwIfNoEntry: false })?.isFile()) return null
  if (!isInside(root, fs.realpathSync(fullPath))) return null
  return { fullPath, type: EXT_TO_TYPE[ext] }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export function registerScripting(getWindow: () => BrowserWindow | undefined): void {
  initCapture(getWindow)

  engine.on('progress', (progress) => getWindow()?.webContents.send(IpcEvents.SCRIPT_PROGRESS, progress))
  engine.on('error', (err: Error) => getWindow()?.webContents.send(IpcEvents.SCRIPT_ERROR, err.message))
  engine.on('log', (message: string) => getWindow()?.webContents.send(IpcEvents.SCRIPT_LOG, message))

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
          } else if (entry.isFile()) {
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

  ipcMain.handle(IpcEvents.SCRIPT_SET_OPTIONS, (_: IpcMainInvokeEvent, opts: {
    typeDelay?: number
    keyPressDelay?: number
    saveDir?: string
  }) => {
    if (opts.typeDelay     !== undefined) engine.typeDelay     = opts.typeDelay
    if (opts.keyPressDelay !== undefined) engine.keyPressDelay = opts.keyPressDelay
    if (opts.saveDir       !== undefined) {
      configuredScriptsDir = opts.saveDir || null
      saveScriptConfig()
    }
  })
}