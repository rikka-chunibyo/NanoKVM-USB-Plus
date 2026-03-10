/**
 * components/script/index.tsx
 *
 * Full scripting panel — editor, saved scripts, console output.
 * Opened as an Ant Design Modal from the menu bar.
 */

import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Divider, Modal, Progress, Tooltip } from 'antd'
import clsx from 'clsx'
import {
  ChevronRightIcon,
  CircleStopIcon,
  CodeIcon,
  FileCodeIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from 'lucide-react'

import { IpcEvents } from '@common/ipc-events'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScriptType   = 'dsl' | 'js' | 'python'
type ScriptStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

type SavedScript = { name: string; type: ScriptType }

type LogEntry = { id: number; text: string; kind: 'log' | 'error' | 'info' }

const LANG_LABEL: Record<ScriptType, string> = { dsl: 'DSL', js: 'JavaScript', python: 'Python' }

const LANG_COLOR: Record<ScriptType, string> = {
  dsl:    'bg-sky-500/20 text-sky-300 border-sky-500/30',
  js:     'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  python: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}

const STATUS_COLOR: Record<ScriptStatus, string> = {
  idle:    'text-neutral-400',
  running: 'text-blue-400',
  paused:  'text-yellow-400',
  done:    'text-emerald-400',
  error:   'text-red-400',
}

const DEFAULT_SCRIPTS: Record<ScriptType, string> = {
  dsl: `# DSL Script
# Commands: type, key, delay, mouse move/click/scroll, repeat...end, screenshot, log

log Starting script
delay 500
type Hello from NanoKVM-USB!
key enter
`,
  js: `#!js
// JavaScript — full Node.js, top-level await, require() available
// kvm.type(), kvm.key(), kvm.delay(), kvm.screenshot(), etc.

kvm.log('Starting script')
await kvm.delay(500)
await kvm.type('Hello from NanoKVM-USB!')
await kvm.key('enter')
`,
  python: `#!python
# Python — import kvm to control the device
# kvm.screenshot() returns a path to a PNG temp file

import kvm

kvm.log('Starting script')
kvm.delay(500)
kvm.type('Hello from NanoKVM-USB!')
kvm.key('enter')

# Image processing example:
# from PIL import Image
# path = kvm.screenshot()
# img = Image.open(path)
# kvm.log(f'Screen is {img.size[0]}x{img.size[1]}')
`,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let logIdCounter = 0

export const Script = (): ReactElement => {
  const [isOpen, setIsOpen]           = useState(false)
  const [source, setSource]           = useState(DEFAULT_SCRIPTS.dsl)
  const [scriptType, setScriptType]   = useState<ScriptType>('dsl')
  const [status, setStatus]           = useState<ScriptStatus>('idle')
  const [progress, setProgress]       = useState({ line: 0, total: 0 })
  const [logs, setLogs]               = useState<LogEntry[]>([])
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [saveName, setSaveName]       = useState('')
  const [showSaved, setShowSaved]     = useState(false)
  const [activeTab, setActiveTab]     = useState<'editor' | 'saved'>('editor')

  const consoleRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── IPC listeners ──────────────────────────────────────────────────────────

  useEffect(() => {
    const rmProgress = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_PROGRESS, (_, p) => {
      setStatus(p.status)
      setProgress({ line: p.line, total: p.total })
      if (p.message) addLog(p.message, 'info')
    })

    const rmError = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_ERROR, (_, msg: string) => {
      setStatus('error')
      addLog(`Error: ${msg}`, 'error')
    })

    const rmLog = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_LOG, (_, msg: string) => {
      addLog(msg, 'log')
    })

    return () => { rmProgress(); rmError(); rmLog() }
  }, [])

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs])

  // ── Helpers ────────────────────────────────────────────────────────────────

  function addLog(text: string, kind: LogEntry['kind']): void {
    setLogs((prev) => [...prev.slice(-499), { id: logIdCounter++, text, kind }])
  }

  async function loadSavedList(): Promise<void> {
    const list = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_LIST)
    setSavedScripts(list)
  }

  function switchType(type: ScriptType): void {
    setScriptType(type)
    // If current source is still the default for old type, swap in new default
    if (source === DEFAULT_SCRIPTS[scriptType]) {
      setSource(DEFAULT_SCRIPTS[type])
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleRun(): Promise<void> {
    setLogs([])
    const result = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_RUN, source, scriptType)
    if (!result.ok) addLog(result.error ?? 'Failed to start', 'error')
  }

  async function handlePause(): Promise<void> {
    await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_PAUSE)
  }

  async function handleResume(): Promise<void> {
    await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_RESUME)
  }

  async function handleStop(): Promise<void> {
    await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_STOP)
  }

  async function handleSave(): Promise<void> {
    const name = saveName.trim() || `Script ${Date.now()}`
    const result = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_SAVE, name, source, scriptType)
    if (result.ok) {
      addLog(`Saved as "${name}"`, 'info')
      setSaveName('')
      loadSavedList()
    } else {
      addLog(`Save failed: ${result.error}`, 'error')
    }
  }

  async function handleLoad(name: string): Promise<void> {
    const result = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_LOAD, name)
    if (result.ok) {
      setSource(result.source)
      setScriptType(result.type)
      setActiveTab('editor')
    } else {
      addLog(`Load failed: ${result.error}`, 'error')
    }
  }

  async function handleDelete(name: string): Promise<void> {
    await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_DELETE, name)
    loadSavedList()
  }

  function handleOpen(): void {
    setIsOpen(true)
    loadSavedList()
  }

  const isRunning = status === 'running'
  const isPaused  = status === 'paused'
  const isBusy    = isRunning || isPaused
  const pct = progress.total > 0 ? Math.round((progress.line / progress.total) * 100) : 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Menu trigger button */}
      <Tooltip title="Scripts" placement="bottom">
        <div
          className={clsx(
            'flex h-[28px] cursor-pointer items-center justify-center rounded px-2 hover:bg-neutral-700/70',
            isBusy ? 'text-blue-400' : 'text-white'
          )}
          onClick={handleOpen}
        >
          <FileCodeIcon size={18} />
        </div>
      </Tooltip>

      <Modal
        open={isOpen}
        onCancel={() => setIsOpen(false)}
        footer={null}
        width={860}
        title={
          <div className="flex items-center gap-2 text-white">
            <FileCodeIcon size={16} />
            <span>Scripts</span>
            <span className={clsx('ml-2 text-xs font-normal capitalize', STATUS_COLOR[status])}>
              {status}
            </span>
          </div>
        }
        styles={{ content: { background: '#1a1a1a', padding: 0 }, header: { background: '#1a1a1a', padding: '14px 20px 10px', borderBottom: '1px solid #2a2a2a' } }}
        destroyOnHidden
      >
        <div className="flex h-[580px] flex-col">

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-neutral-800 px-4 pt-2">
            {(['editor', 'saved'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); if (tab === 'saved') loadSavedList() }}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-t transition-colors capitalize',
                  activeTab === tab
                    ? 'text-white border-b-2 border-blue-500'
                    : 'text-neutral-400 hover:text-white'
                )}
              >
                {tab}
                {tab === 'saved' && savedScripts.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-neutral-700 px-1.5 py-0.5 text-xs">{savedScripts.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* ── Editor tab ── */}
          {activeTab === 'editor' && (
            <div className="flex flex-1 flex-col overflow-hidden">

              {/* Toolbar */}
              <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
                {/* Language selector */}
                <div className="flex rounded border border-neutral-700 overflow-hidden">
                  {(['dsl', 'js', 'python'] as ScriptType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => switchType(t)}
                      className={clsx(
                        'px-2.5 py-1 text-xs font-mono transition-colors',
                        scriptType === t
                          ? LANG_COLOR[t] + ' border-r border-neutral-700'
                          : 'text-neutral-500 hover:text-neutral-300 border-r border-neutral-700 last:border-0'
                      )}
                    >
                      {LANG_LABEL[t]}
                    </button>
                  ))}
                </div>

                <div className="flex-1" />

                {/* Save */}
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  placeholder="Script name…"
                  className="w-36 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white placeholder-neutral-500 outline-none focus:border-neutral-500"
                />
                <Tooltip title="Save script">
                  <button onClick={handleSave} className="flex h-[26px] w-[26px] items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white">
                    <SaveIcon size={14} />
                  </button>
                </Tooltip>

                <Divider type="vertical" className="!mx-1" />

                {/* Run controls */}
                {!isBusy && (
                  <button
                    onClick={handleRun}
                    className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                  >
                    <PlayIcon size={12} />
                    Run
                  </button>
                )}
                {isRunning && (
                  <>
                    <button onClick={handlePause} className="flex items-center gap-1.5 rounded bg-yellow-600/80 px-3 py-1 text-xs text-white hover:bg-yellow-500">
                      <PauseIcon size={12} />
                      Pause
                    </button>
                    <button onClick={handleStop} className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1 text-xs text-white hover:bg-neutral-600">
                      <CircleStopIcon size={12} />
                      Stop
                    </button>
                  </>
                )}
                {isPaused && (
                  <>
                    <button onClick={handleResume} className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500">
                      <PlayIcon size={12} />
                      Resume
                    </button>
                    <button onClick={handleStop} className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1 text-xs text-white hover:bg-neutral-600">
                      <CircleStopIcon size={12} />
                      Stop
                    </button>
                  </>
                )}
              </div>

              {/* Editor */}
              <textarea
                ref={textareaRef}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none bg-neutral-950 p-4 font-mono text-sm text-neutral-200 outline-none placeholder-neutral-600"
                style={{ minHeight: 0 }}
              />

              {/* Progress bar */}
              {isBusy && (
                <div className="px-4 py-1.5 border-t border-neutral-800">
                  <Progress
                    percent={pct}
                    size="small"
                    showInfo={false}
                    strokeColor={isPaused ? '#ca8a04' : '#3b82f6'}
                    trailColor="#262626"
                  />
                </div>
              )}

              {/* Console */}
              <div className="border-t border-neutral-800">
                <div className="flex items-center justify-between px-4 py-1.5">
                  <span className="text-xs text-neutral-500">Console</span>
                  <button onClick={() => setLogs([])} className="text-xs text-neutral-600 hover:text-neutral-400">
                    Clear
                  </button>
                </div>
                <div
                  ref={consoleRef}
                  className="h-32 overflow-y-auto px-4 pb-2 font-mono text-xs"
                >
                  {logs.length === 0 ? (
                    <span className="text-neutral-600">No output yet</span>
                  ) : (
                    logs.map((entry) => (
                      <div
                        key={entry.id}
                        className={clsx(
                          'leading-5',
                          entry.kind === 'error' ? 'text-red-400' :
                          entry.kind === 'info'  ? 'text-neutral-500' : 'text-neutral-300'
                        )}
                      >
                        {entry.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Saved tab ── */}
          {activeTab === 'saved' && (
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              {savedScripts.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-500">
                  <FileCodeIcon size={32} className="opacity-30" />
                  <p className="text-sm">No saved scripts yet</p>
                  <p className="text-xs">Give a script a name and click Save</p>
                </div>
              ) : (
                <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
                  {savedScripts.map((s) => (
                    <div
                      key={s.name}
                      className="group flex items-center rounded px-3 py-2 hover:bg-neutral-800"
                    >
                      <div className="flex flex-1 items-center gap-3">
                        <span className={clsx('rounded border px-1.5 py-0.5 text-[10px] font-mono', LANG_COLOR[s.type])}>
                          {LANG_LABEL[s.type]}
                        </span>
                        <span className="text-sm text-white">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleLoad(s.name)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-white"
                        >
                          <ChevronRightIcon size={12} />
                          Load
                        </button>
                        <button
                          onClick={() => handleDelete(s.name)}
                          className="rounded p-1 text-neutral-600 hover:bg-neutral-700 hover:text-red-400"
                        >
                          <Trash2Icon size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
