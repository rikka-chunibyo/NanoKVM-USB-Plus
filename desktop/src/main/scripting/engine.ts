/**
 * engine.ts
 *

 *



 */

import { EventEmitter } from 'events'
import { Device } from '../device'
import { createKvmApi, KvmApi, ScreenshotFn } from './kvm-api'
import { runJavaScript, validateJavaScript, JsRunnerError } from './js-runner'
import { runPython, validatePython, PythonRunnerError } from './python-runner'

export { validateJavaScript, validatePython, JsRunnerError, PythonRunnerError }

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

export type ScriptType = 'dsl' | 'js' | 'python'


// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ScriptStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

export interface ScriptProgress {
  status: ScriptStatus
  line: number
  total: number
  message?: string
}

// ---------------------------------------------------------------------------
// DSL AST
// ---------------------------------------------------------------------------

type InstrDelay      = { kind: 'delay';        ms: number }
type InstrType       = { kind: 'type';          text: string }
type InstrKey        = { kind: 'key';           combo: string; times: number }
type InstrMouseMove  = { kind: 'mouse_move';    x: number; y: number; relative: boolean }
type InstrMouseClick = { kind: 'mouse_click';   button: 'left'|'right'|'middle'; times: number }
type InstrMouseScroll= { kind: 'mouse_scroll';  delta: number }
type InstrScreenshot = { kind: 'screenshot';    outVar?: string }
type InstrRepeat     = { kind: 'repeat';        count: number; body: Instruction[] }
type InstrLog        = { kind: 'log';           message: string }

export type Instruction =
  | InstrDelay | InstrType | InstrKey
  | InstrMouseMove | InstrMouseClick | InstrMouseScroll
  | InstrScreenshot | InstrRepeat | InstrLog

// ---------------------------------------------------------------------------
// DSL Parser
// ---------------------------------------------------------------------------

export class ScriptParseError extends Error {
  readonly lineNumber: number
  readonly lineText: string
  constructor(lineNumber: number, lineText: string, message: string) {
    super(`Line ${lineNumber}: ${message} → "${lineText}"`)
    this.lineNumber = lineNumber
    this.lineText = lineText
    this.name = 'ScriptParseError'
  }
}

function parseInstructions(lines: string[], startLine = 0): { instructions: Instruction[]; consumed: number } {
  const instructions: Instruction[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i]
    const lineNo = startLine + i + 1
    const line = rawLine.replace(/#.*$/, '').trim()
    i++

    if (!line) continue

    const spaceIdx = line.indexOf(' ')
    const cmd  = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase()
    const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1)

    switch (cmd) {
      case 'delay': {
        const ms = parseInt(rest, 10)
        if (isNaN(ms) || ms < 0) throw new ScriptParseError(lineNo, rawLine, `Invalid delay: "${rest}"`)
        instructions.push({ kind: 'delay', ms })
        break
      }
      case 'type': {
        const rawRest = rawLine.replace(/^\s*type\s/, '')
        if (!rawRest.trim()) throw new ScriptParseError(lineNo, rawLine, 'type requires text')
        instructions.push({ kind: 'type', text: rawRest })
        break
      }
      case 'key': {
        const parts = rest.trim().split(/\s+/)
        const times = parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]) ? parseInt(parts.pop()!, 10) : 1
        const combo = parts.join('+')
        if (!combo) throw new ScriptParseError(lineNo, rawLine, 'key requires a combo')
        instructions.push({ kind: 'key', combo, times })
        break
      }
      case 'mouse': {
        const [sub, ...subArgs] = rest.split(/\s+/)
        if (!sub) throw new ScriptParseError(lineNo, rawLine, 'mouse requires sub-command: move|click|scroll')
        switch (sub.toLowerCase()) {
          case 'move': {
            const x = parseInt(subArgs[0], 10), y = parseInt(subArgs[1], 10)
            if (isNaN(x) || isNaN(y)) throw new ScriptParseError(lineNo, rawLine, 'mouse move requires x y integers')
            instructions.push({ kind: 'mouse_move', x, y, relative: subArgs[2]?.toLowerCase() !== 'abs' })
            break
          }
          case 'click': {
            let button: 'left'|'right'|'middle' = 'left', times = 1
            for (const a of subArgs) {
              if (['left','right','middle'].includes(a.toLowerCase())) button = a.toLowerCase() as typeof button
              else if (/^\d+$/.test(a)) times = parseInt(a, 10)
            }
            instructions.push({ kind: 'mouse_click', button, times })
            break
          }
          case 'scroll': {
            const delta = parseInt(subArgs[0], 10)
            if (isNaN(delta)) throw new ScriptParseError(lineNo, rawLine, 'mouse scroll requires integer delta')
            instructions.push({ kind: 'mouse_scroll', delta })
            break
          }
          default: throw new ScriptParseError(lineNo, rawLine, `Unknown mouse sub-command: "${sub}"`)
        }
        break
      }
      case 'screenshot':
        instructions.push({ kind: 'screenshot', outVar: rest.trim() || undefined })
        break
      case 'repeat': {
        const count = parseInt(rest, 10)
        if (isNaN(count) || count < 1) throw new ScriptParseError(lineNo, rawLine, 'repeat requires positive integer')
        const bodyLines: string[] = []
        while (i < lines.length && lines[i].trim().toLowerCase() !== 'end') bodyLines.push(lines[i++])
        if (i >= lines.length) throw new ScriptParseError(lineNo, rawLine, 'repeat missing "end"')
        i++
        const { instructions: body } = parseInstructions(bodyLines, startLine + i - bodyLines.length - 1)
        instructions.push({ kind: 'repeat', count, body })
        break
      }
      case 'end':
        throw new ScriptParseError(lineNo, rawLine, 'Unexpected "end" without matching "repeat"')
      case 'log':
        instructions.push({ kind: 'log', message: rest })
        break
      default:
        throw new ScriptParseError(lineNo, rawLine, `Unknown command: "${cmd}"`)
    }
  }

  return { instructions, consumed: i }
}

export function parseScript(source: string): Instruction[] {
  const lines = source.split('\n')
  
  return parseInstructions(lines).instructions
}

export function validateDsl(source: string): { ok: boolean; error?: string } {
  try { parseScript(source); return { ok: true } }
  catch (err) { return { ok: false, error: (err as Error).message } }
}

function countInstructions(instructions: Instruction[]): number {
  let n = 0
  for (const instr of instructions) {
    n++
    if (instr.kind === 'repeat') n += instr.count * countInstructions(instr.body)
  }
  return n
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ScriptEngine extends EventEmitter {
  private device: Device
  private screenshotFn: ScreenshotFn
  private _status: ScriptStatus = 'idle'
  private _abort: AbortController | null = null
  private _paused = false
  private _pauseResolve: (() => void) | null = null

  typeDelay     = 30
  keyPressDelay = 20

  constructor(device: Device, screenshotFn: ScreenshotFn) {
    super()
    this.device = device
    this.screenshotFn = screenshotFn
  }

  get status(): ScriptStatus { return this._status }

  pause(): void {
    if (this._status !== 'running') return
    this._paused = true
    this._status = 'paused'
    this.emit('progress', this.prog(0, 0))
  }

  resume(): void {
    if (this._status !== 'paused') return
    this._paused = false
    this._status = 'running'
    this._pauseResolve?.(); this._pauseResolve = null
  }

  stop(): void {
    this._abort?.abort()
    this._paused = false
    this._pauseResolve?.(); this._pauseResolve = null
  }

  async run(source: string, forceType?: ScriptType): Promise<void> {
    if (this._status === 'running' || this._status === 'paused') {
      this.emit('error', new Error('Already running')); return
    }
    this._paused = false
    this._status = 'running'
    this._abort = new AbortController()
    const { signal } = this._abort
    const type = forceType ?? 'dsl'

    const kvm = createKvmApi(this.device, (m) => this.emit('log', m), this.screenshotFn)
    kvm.typeDelay     = this.typeDelay
    kvm.keyPressDelay = this.keyPressDelay

    try {
      if (type === 'js')     await runJavaScript(source, kvm, signal)
      else if (type === 'python') await runPython(source, kvm, signal)
      else                   await this.runDsl(source, kvm, signal)

      this._status = signal.aborted ? 'idle' : 'done'
      this.emit('progress', this.prog(1, 1, signal.aborted ? 'Stopped' : 'Complete'))
    } catch (err) {
      this._status = 'error'
      this.emit('error', err)
    } finally {
      this._abort = null
    }
  }

  private async runDsl(source: string, kvm: KvmApi, signal: AbortSignal): Promise<void> {
    const instructions = parseScript(source)
    const total = countInstructions(instructions)
    const cursor = { value: 0 }
    await this.execList(instructions, kvm, signal, total, cursor)
  }

  private async execList(
    list: Instruction[], kvm: KvmApi, signal: AbortSignal,
    total: number, cursor: { value: number }
  ): Promise<void> {
    for (const instr of list) {
      if (signal.aborted) return
      await this.waitResume()
      if (signal.aborted) return
      await this.execOne(instr, kvm, signal, total, cursor)
    }
  }

  private async execOne(
    instr: Instruction, kvm: KvmApi, signal: AbortSignal,
    total: number, cursor: { value: number }
  ): Promise<void> {
    cursor.value++
    this.emit('progress', this.prog(cursor.value, total))

    switch (instr.kind) {
      case 'delay':        await kvm.delay(instr.ms); break
      case 'type':         await kvm.type(instr.text); break
      case 'key':          await kvm.key(instr.combo, instr.times); break
      case 'mouse_move':   await kvm.mouseMove(instr.x, instr.y, instr.relative ? 'rel' : 'abs'); break
      case 'mouse_click':  await kvm.mouseClick(instr.button, instr.times); break
      case 'mouse_scroll': await kvm.mouseScroll(instr.delta); break
      case 'screenshot': {
        const result = await kvm.screenshot()
        kvm.log(`Screenshot saved: ${result.path} (${result.width}×${result.height})`)
        break
      }
      case 'log': kvm.log(instr.message); break
      case 'repeat':
        for (let i = 0; i < instr.count; i++) {
          if (signal.aborted) return
          await this.execList(instr.body, kvm, signal, total, cursor)
        }
        break
    }
  }

  private waitResume(): Promise<void> {
    if (!this._paused) return Promise.resolve()
    return new Promise<void>((r) => { this._pauseResolve = r })
  }

  private prog(line: number, total: number, message?: string): ScriptProgress {
    return { status: this._status, line, total, message }
  }
}