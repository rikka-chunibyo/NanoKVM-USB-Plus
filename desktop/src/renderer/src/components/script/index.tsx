/**
 * components/script/index.tsx
 *
 * Single-editor script panel with:
 *  - Language selector (DSL / JavaScript / Python)
 *  - Built-in examples per language
 *  - File browser with folder support (type "folder/name" to save into a folder)
 *  - Monaco editor wired to local monaco-editor package (no CDN = no CSP hang)
 */

import { ReactElement, useEffect, useRef, useState } from 'react'
import { Modal, Tooltip } from 'antd'
import clsx from 'clsx'
import {
  CircleStopIcon, FileCodeIcon, FolderIcon, FolderOpenIcon,
  PauseIcon, PlayIcon, SaveIcon, ChevronRightIcon,
  Trash2Icon, BookOpenIcon, ChevronDownIcon,
} from 'lucide-react'
import Editor, { loader, useMonaco } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { IpcEvents } from '@common/ipc-events'

// Point the loader at the locally installed package — bypasses CDN fetch
// which hangs in Electron due to CSP restrictions.
loader.config({ monaco })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScriptType   = 'dsl' | 'js' | 'python'
type ScriptStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'
type SavedScript  = { filename: string; displayName: string; type: ScriptType; folder: string }
type LogEntry     = { id: number; text: string; kind: 'log' | 'error' | 'info' }

const LANG_LABEL:  Record<ScriptType, string> = { dsl: 'DSL', js: 'JavaScript', python: 'Python' }
const MONACO_LANG: Record<ScriptType, string> = { dsl: 'plaintext', js: 'javascript', python: 'python' }

const LANG_COLOR: Record<ScriptType, string> = {
  dsl:    'bg-sky-500/20 text-sky-300 border-sky-500/30',
  js:     'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  python: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}

const STATUS_COLOR: Record<ScriptStatus, string> = {
  idle: 'text-neutral-400', running: 'text-blue-400', paused: 'text-yellow-400',
  done: 'text-emerald-400', error: 'text-red-400',
}

// ---------------------------------------------------------------------------
// Built-in examples
// ---------------------------------------------------------------------------

type Example = { label: string; source: string }

const EXAMPLES: Record<ScriptType, Example[]> = {
  dsl: [
    {
      label: 'Hello World',
      source: `log Starting
delay 500
type Hello from NanoKVM-USB!
key enter
`,
    },
    {
      label: 'Open Run dialog (Windows)',
      source: `key meta+r
delay 500
type notepad
key enter
delay 1000
type Hello from NanoKVM-USB!
`,
    },
    {
      label: 'Repeat click',
      source: `log Clicking 5 times
repeat 5
  mouse click left
  delay 300
end
log Done
`,
    },
    {
      label: 'Screenshot',
      source: `log Taking screenshot
screenshot
log Done — check console for path
`,
    },
  ],
  js: [
    {
      label: 'Hello World',
      source: `kvm.log('Starting')
await kvm.delay(500)
await kvm.type('Hello from NanoKVM-USB!')
await kvm.key('enter')
`,
    },
    {
      label: 'Screenshot + log size',
      source: `const shot = await kvm.screenshot()
kvm.log(\`Screenshot: \${shot.width}x\${shot.height} → \${shot.path}\`)
`,
    },
    {
      label: 'Retry loop',
      source: `for (let i = 0; i < 3; i++) {
  kvm.log(\`Attempt \${i + 1}\`)
  await kvm.key('ctrl+l')
  await kvm.delay(300)
  await kvm.type('http://192.168.1.1')
  await kvm.key('enter')
  await kvm.delay(2000)
}
kvm.log('Done')
`,
    },
    {
      label: 'Mouse grid click',
      source: `// Click a 3x3 grid of points (absolute coords)
const points = [
  [400, 300], [800, 300], [1200, 300],
  [400, 600], [800, 600], [1200, 600],
  [400, 900], [800, 900], [1200, 900],
]
for (const [x, y] of points) {
  await kvm.mouseMove(x, y, 'abs')
  await kvm.mouseClick()
  await kvm.delay(200)
}
`,
    },
  ],
  python: [
    {
      label: 'Hello World',
      source: `import kvm

kvm.log('Starting')
kvm.delay(500)
kvm.type('Hello from NanoKVM-USB!')
kvm.key('enter')
`,
    },
    {
      label: 'Screenshot with PIL',
      source: `import kvm
from PIL import Image

path = kvm.screenshot()
img = Image.open(path)
kvm.log(f'Screen: {img.size[0]}x{img.size[1]}')

# Example: check if a pixel is red-ish
r, g, b = img.getpixel((100, 100))[:3]
kvm.log(f'Pixel at (100,100): R={r} G={g} B={b}')
`,
    },
    {
      label: 'Find color and click',
      source: `import kvm
from PIL import Image
import numpy as np

path = kvm.screenshot()
img = np.array(Image.open(path))

# Find pixels where red > 200, green < 100, blue < 100
mask = (img[:,:,0] > 200) & (img[:,:,1] < 100) & (img[:,:,2] < 100)
ys, xs = np.where(mask)

if len(xs) > 0:
    cx, cy = int(xs.mean()), int(ys.mean())
    kvm.log(f'Red region centroid: ({cx}, {cy})')
    kvm.mouse_move(cx, cy, 'abs')
    kvm.mouse_click()
else:
    kvm.log('No red region found')
`,
    },
    {
      label: 'Type clipboard contents',
      source: `import kvm
import subprocess
import sys

def get_clipboard():
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.user32.OpenClipboard(0)
        handle = ctypes.windll.user32.GetClipboardData(1)
        text = ctypes.cast(handle, ctypes.c_char_p).value.decode('utf-8', errors='replace')
        ctypes.windll.user32.CloseClipboard()
        return text
    elif sys.platform == 'darwin':
        return subprocess.check_output(['pbpaste']).decode('utf-8')
    else:
        return subprocess.check_output(['xclip', '-selection', 'clipboard', '-o']).decode('utf-8')

text = get_clipboard()
kvm.log(f'Typing {len(text)} chars from clipboard')
kvm.type(text)
kvm.log('Done')
`,
    },
  ],
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let logId = 0

export const Script = (): ReactElement => {
  const monacoInstance = useMonaco()

  const [isOpen, setIsOpen]         = useState(false)
  const [source, setSource]         = useState(EXAMPLES.dsl[0].source)
  const [scriptType, setScriptType] = useState<ScriptType>('dsl')
  const [status, setStatus]         = useState<ScriptStatus>('idle')
  const [progress, setProgress]     = useState({ line: 0, total: 0 })
  const [logs, setLogs]             = useState<LogEntry[]>([])
  const [savedScripts, setSaved]    = useState<SavedScript[]>([])
  const [saveName, setSaveName]     = useState('')
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(['']))
  const [showExamples, setShowExamples] = useState(false)
  const [showFiles, setShowFiles]   = useState(true)

  const consoleRef = useRef<HTMLDivElement>(null)

  // Register DSL syntax + theme once Monaco is ready
  useEffect(() => {
    if (!monacoInstance) return
    if (monacoInstance.languages.getLanguages().some((l) => l.id === 'kvmscript')) return

    monacoInstance.languages.register({ id: 'kvmscript' })
    monacoInstance.languages.setMonarchTokensProvider('kvmscript', {
      keywords: ['type', 'key', 'delay', 'mouse', 'repeat', 'end', 'log', 'screenshot'],
      tokenizer: {
        root: [
          [/#.*$/, 'comment'],
          [/\b(type|key|delay|mouse|repeat|end|log|screenshot)\b/, 'keyword'],
          [/\d+/, 'number'],
          [/"[^"]*"/, 'string'],
        ],
      },
    } as any)
    monacoInstance.editor.defineTheme('kvm-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'comment', foreground: '6a9955' },
        { token: 'number',  foreground: 'b5cea8' },
        { token: 'string',  foreground: 'ce9178' },
      ],
      colors: { 'editor.background': '#0d0d0d' },
    })
  }, [monacoInstance])

  // IPC listeners
  useEffect(() => {
    const r1 = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_PROGRESS, (_, p) => {
      setStatus(p.status)
      setProgress({ line: p.line, total: p.total })
      if (p.message) addLog(p.message, 'info')
    })
    const r2 = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_ERROR, (_, msg: string) => {
      setStatus('error'); addLog(`Error: ${msg}`, 'error')
    })
    const r3 = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_LOG, (_, msg: string) => {
      addLog(msg, 'log')
    })
    return () => { r1(); r2(); r3() }
  }, [])

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [logs])

  // ── Helpers ────────────────────────────────────────────────────────────────

  function addLog(text: string, kind: LogEntry['kind']): void {
    setLogs(prev => [...prev.slice(-499), { id: logId++, text, kind }])
  }

  async function loadSavedList(): Promise<void> {
    const list: SavedScript[] = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_LIST)
    setSaved(list)
  }

  function toggleFolder(folder: string): void {
    setOpenFolders(prev => {
      const next = new Set(prev)
      next.has(folder) ? next.delete(folder) : next.add(folder)
      return next
    })
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleRun(): Promise<void> {
    setLogs([])
    const r = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_RUN, source, scriptType)
    if (!r.ok) addLog(r.error ?? 'Failed to start', 'error')
  }

  async function handlePause():  Promise<void> { await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_PAUSE) }
  async function handleResume(): Promise<void> { await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_RESUME) }
  async function handleStop():   Promise<void> { await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_STOP) }

  async function handleSave(): Promise<void> {
    const name = saveName.trim() || `Script ${Date.now()}`
    const r = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_SAVE, name, source, scriptType)
    if (r.ok) {
      addLog(`Saved "${name}"`, 'info')
      setSaveName('')
      loadSavedList()
    } else {
      addLog(`Save failed: ${r.error}`, 'error')
    }
  }

  async function handleLoad(filename: string): Promise<void> {
    const r = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_LOAD, filename)
    if (r.ok) {
      setSource(r.source)
      setScriptType(r.type)
    } else {
      addLog(`Load failed: ${r.error}`, 'error')
    }
  }

  async function handleDelete(filename: string): Promise<void> {
    await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_DELETE, filename)
    loadSavedList()
  }

  function handleOpen(): void {
    setIsOpen(true)
    loadSavedList()
  }

  function loadExample(ex: Example): void {
    setSource(ex.source)
  }

  // Group saved scripts by folder
  const byFolder = savedScripts.reduce<Record<string, SavedScript[]>>((acc, s) => {
    ;(acc[s.folder] ??= []).push(s)
    return acc
  }, {})
  const folders = Object.keys(byFolder).sort((a, b) =>
    a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)
  )

  const isRunning = status === 'running'
  const isPaused  = status === 'paused'
  const isBusy    = isRunning || isPaused
  const pct = progress.total > 0 ? Math.round((progress.line / progress.total) * 100) : 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
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
        width={1000}
        title={
          <div className="flex items-center gap-2 text-white">
            <FileCodeIcon size={16} />
            <span>Scripts</span>
            <span className={clsx('ml-2 text-xs font-normal capitalize', STATUS_COLOR[status])}>
              {status}
            </span>
            {isBusy && progress.total > 0 && (
              <span className="text-xs text-neutral-500">
                {progress.line}/{progress.total}
              </span>
            )}
          </div>
        }
        styles={{
          content: { background: '#0d0d0d', padding: 0 },
          header:  { background: '#0d0d0d', padding: '12px 20px 10px', borderBottom: '1px solid #1e1e1e' },
        }}
        destroyOnHidden
      >
        <div className="flex h-[640px]">

          {/* ── Sidebar ── */}
          <div className="flex w-52 flex-shrink-0 flex-col border-r border-neutral-800 overflow-hidden">

            {/* Language */}
            <div className="border-b border-neutral-800 p-2">
              <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-neutral-600">Language</div>
              {(['dsl', 'js', 'python'] as ScriptType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setScriptType(t)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors',
                    scriptType === t ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                  )}
                >
                  <span className={clsx('rounded border px-1 py-0.5 text-[9px] font-mono', LANG_COLOR[t])}>
                    {LANG_LABEL[t]}
                  </span>
                </button>
              ))}
            </div>

            {/* Examples */}
            <div className="border-b border-neutral-800">
              <button
                onClick={() => setShowExamples(!showExamples)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-neutral-400 hover:text-white"
              >
                <div className="flex items-center gap-1.5">
                  <BookOpenIcon size={12} />
                  <span>Examples</span>
                </div>
                <ChevronDownIcon size={12} className={clsx('transition-transform', showExamples && 'rotate-180')} />
              </button>
              {showExamples && (
                <div className="pb-1">
                  {EXAMPLES[scriptType].map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => loadExample(ex)}
                      className="w-full px-4 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Saved files */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <button
                onClick={() => setShowFiles(!showFiles)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-neutral-400 hover:text-white"
              >
                <div className="flex items-center gap-1.5">
                  <FolderIcon size={12} />
                  <span>Saved Scripts</span>
                  {savedScripts.length > 0 && (
                    <span className="rounded-full bg-neutral-700 px-1.5 text-[10px]">{savedScripts.length}</span>
                  )}
                </div>
                <ChevronDownIcon size={12} className={clsx('transition-transform', showFiles && 'rotate-180')} />
              </button>

              {showFiles && (
                <div className="flex-1 overflow-y-auto">
                  {savedScripts.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-neutral-600">No saved scripts yet</p>
                  ) : (
                    folders.map((folder) => (
                      <div key={folder || '__root__'}>
                        {/* Folder row — only show if it's a named folder */}
                        {folder !== '' && (
                          <button
                            onClick={() => toggleFolder(folder)}
                            className="flex w-full items-center gap-1.5 px-3 py-1 text-xs text-neutral-400 hover:text-white"
                          >
                            {openFolders.has(folder)
                              ? <FolderOpenIcon size={11} />
                              : <FolderIcon size={11} />
                            }
                            <span className="truncate">{folder}</span>
                          </button>
                        )}
                        {/* Files in folder */}
                        {(folder === '' || openFolders.has(folder)) && byFolder[folder].map((s) => (
                          <div key={s.filename} className="group flex items-center px-2">
                            <button
                              onClick={() => handleLoad(s.filename)}
                              className={clsx(
                                'flex flex-1 items-center gap-1.5 truncate rounded px-2 py-1 text-left text-xs hover:bg-neutral-800',
                                folder !== '' && 'pl-4',
                              )}
                            >
                              <span className={clsx('shrink-0 rounded border px-1 text-[9px] font-mono', LANG_COLOR[s.type])}>
                                {s.type === 'dsl' ? 'D' : s.type === 'js' ? 'J' : 'P'}
                              </span>
                              <span className="truncate text-neutral-300">{s.displayName}</span>
                            </button>
                            <button
                              onClick={() => handleDelete(s.filename)}
                              className="hidden rounded p-0.5 text-neutral-700 hover:text-red-400 group-hover:flex"
                            >
                              <Trash2Icon size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Save controls */}
            <div className="border-t border-neutral-800 p-2">
              <div className="mb-1 px-1 text-[10px] text-neutral-600">folder/name or just name</div>
              <div className="flex gap-1">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleSave() }}
                  onKeyUp={(e) => e.stopPropagation()}
                  placeholder="my script"
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white placeholder-neutral-600 outline-none focus:border-neutral-500"
                />
                <button
                  onClick={handleSave}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white"
                >
                  <SaveIcon size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* ── Main editor area ── */}
          <div className="flex flex-1 flex-col overflow-hidden">

            {/* Run toolbar */}
            <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
              <span className={clsx('text-xs font-mono', LANG_COLOR[scriptType].split(' ')[1])}>
                {LANG_LABEL[scriptType]}
              </span>
              <div className="flex-1" />
              {!isBusy && (
                <button onClick={handleRun} className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500">
                  <PlayIcon size={12} /> Run
                </button>
              )}
              {isRunning && (
                <>
                  <button onClick={handlePause} className="flex items-center gap-1.5 rounded bg-yellow-600/80 px-3 py-1 text-xs text-white hover:bg-yellow-500">
                    <PauseIcon size={12} /> Pause
                  </button>
                  <button onClick={handleStop} className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-600">
                    <CircleStopIcon size={12} /> Stop
                  </button>
                </>
              )}
              {isPaused && (
                <>
                  <button onClick={handleResume} className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500">
                    <PlayIcon size={12} /> Resume
                  </button>
                  <button onClick={handleStop} className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-600">
                    <CircleStopIcon size={12} /> Stop
                  </button>
                </>
              )}
              {isBusy && progress.total > 0 && (
                <div className="w-24">
                  <div className="h-1 rounded bg-neutral-700">
                    <div
                      className={clsx('h-1 rounded transition-all', isPaused ? 'bg-yellow-500' : 'bg-blue-500')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Monaco — stop propagation so keystrokes don't reach the KVM handler */}
            <div className="flex-1 overflow-hidden" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
              <Editor
                height="100%"
                language={scriptType === 'dsl' ? 'kvmscript' : MONACO_LANG[scriptType]}
                theme="kvm-dark"
                value={source}
                onChange={(val) => setSource(val ?? '')}
                options={{
                  fontSize: 13,
                  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                  fontLigatures: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  tabSize: 2,
                  wordWrap: 'on',
                  padding: { top: 10 },
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  bracketPairColorization: { enabled: true },
                  automaticLayout: true,
                }}
              />
            </div>

            {/* Console */}
            <div className="border-t border-neutral-800">
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-xs text-neutral-600">Console</span>
                <button onClick={() => setLogs([])} className="text-xs text-neutral-700 hover:text-neutral-400">Clear</button>
              </div>
              <div ref={consoleRef} className="h-24 overflow-y-auto px-3 pb-2 font-mono text-xs">
                {logs.length === 0
                  ? <span className="text-neutral-700">No output yet</span>
                  : logs.map((e) => (
                      <div key={e.id} className={clsx('leading-5',
                        e.kind === 'error' ? 'text-red-400' :
                        e.kind === 'info'  ? 'text-neutral-500' : 'text-neutral-300'
                      )}>
                        {e.text}
                      </div>
                    ))
                }
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}