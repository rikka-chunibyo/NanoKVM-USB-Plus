/**
 * components/script/sidebar.tsx
 *
 * Freely draggable floating sidebar showing pinned scripts.
 * - Drag by the grip header anywhere on screen
 * - Position persisted to localStorage, defaults to right-center
 * - Collapses to a slim header bar
 * - Run / Stop / Unpin per script
 */

import { ReactElement, useEffect, useRef, useState } from 'react'
import { Tooltip } from 'antd'
import clsx from 'clsx'
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable'
import {
  ChevronLeftIcon, ChevronRightIcon,
  CircleStopIcon, FileCodeIcon, GripVerticalIcon,
  PlayIcon, PinOffIcon,
} from 'lucide-react'

import { IpcEvents } from '@common/ipc-events'
import { getSidebarPins, setSidebarPins } from '@renderer/libs/storage'

type ScriptType  = 'dsl' | 'js' | 'python'
type SavedScript = { filename: string; displayName: string; type: ScriptType; folder: string }
type Pos         = { x: number; y: number }

const SIDEBAR_POS_KEY = 'nanokvm-script-sidebar-xy'

const LANG_COLOR: Record<ScriptType, string> = {
  dsl:    'bg-sky-500/20 text-sky-300 border-sky-500/30',
  js:     'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  python: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(SIDEBAR_POS_KEY)
    if (raw) return JSON.parse(raw) as Pos
  } catch { /* ignore */ }
  return { x: window.innerWidth - 180, y: Math.max(60, window.innerHeight / 2 - 80) }
}

function savePos(pos: Pos): void {
  localStorage.setItem(SIDEBAR_POS_KEY, JSON.stringify(pos))
}

export const ScriptSidebar = (): ReactElement | null => {
  const [pins, setPins]           = useState<string[]>(getSidebarPins)
  const [scripts, setScripts]     = useState<SavedScript[]>([])
  const [running, setRunning]     = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos]             = useState<Pos>(loadPos)

  const nodeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function sync(): void { setPins(getSidebarPins()) }
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('focus', sync); window.removeEventListener('storage', sync) }
  }, [])

  useEffect(() => {
    if (pins.length === 0) { setScripts([]); return }
    window.electron.ipcRenderer
      .invoke(IpcEvents.SCRIPT_LIST)
      .then((list: SavedScript[]) => setScripts(list.filter((s) => pins.includes(s.filename))))
  }, [pins])

  useEffect(() => {
    const rm = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_PROGRESS, (_, p) => {
      if (p.status === 'idle' || p.status === 'done' || p.status === 'error') setRunning(null)
    })
    return rm
  }, [])

  function unpin(filename: string): void {
    const next = pins.filter((f) => f !== filename)
    setSidebarPins(next)
    setPins(next)
  }

  async function runScript(s: SavedScript): Promise<void> {
    const loaded = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_LOAD, s.filename)
    if (!loaded.ok) return
    const result = await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_RUN, loaded.source, loaded.type)
    if (result.ok) setRunning(s.filename)
  }

  async function stopScript(): Promise<void> {
    await window.electron.ipcRenderer.invoke(IpcEvents.SCRIPT_STOP)
    setRunning(null)
  }

  function onDragStop(_: DraggableEvent, data: DraggableData): void {
    const newPos = { x: data.x, y: data.y }
    setPos(newPos)
    savePos(newPos)
  }

  if (pins.length === 0) return null

  return (
    <Draggable
      nodeRef={nodeRef}
      handle=".sidebar-grip"
      position={pos}
      onStop={onDragStop}
      bounds="window"
    >
      <div
        ref={nodeRef}
        className="fixed z-[990] flex w-44 flex-col rounded-xl border border-neutral-700/60 bg-neutral-900/95 shadow-xl backdrop-blur-sm"
        style={{ top: 0, left: 0 }}
      >
        {/* Grip header */}
        <div className="sidebar-grip flex cursor-grab items-center gap-1 rounded-t-xl px-2 py-1.5 active:cursor-grabbing select-none">
          <GripVerticalIcon size={12} className="text-neutral-600" />
          <FileCodeIcon size={12} className="text-neutral-600" />
          <span className="flex-1 text-[10px] text-neutral-600">Scripts</span>
          <button
            className="text-neutral-600 hover:text-neutral-300 transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }}
          >
            {collapsed ? <ChevronRightIcon size={11} /> : <ChevronLeftIcon size={11} />}
          </button>
        </div>

        {/* Script list */}
        {!collapsed && (
          <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {scripts.map((s) => {
              const isThis = running === s.filename
              return (
                <div
                  key={s.filename}
                  className={clsx(
                    'group flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
                    isThis ? 'bg-blue-600/20' : 'hover:bg-neutral-800',
                  )}
                >
                  <span className={clsx('shrink-0 rounded border px-1 py-0.5 text-[9px] font-mono', LANG_COLOR[s.type])}>
                    {s.type === 'dsl' ? 'D' : s.type === 'js' ? 'J' : 'P'}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-neutral-300 select-none"
                    title={s.folder ? `${s.folder}/${s.displayName}` : s.displayName}
                  >
                    {s.displayName}
                  </span>
                  {isThis ? (
                    <Tooltip title="Stop" placement="left">
                      <button onClick={stopScript} className="text-red-400 hover:text-red-300">
                        <CircleStopIcon size={13} />
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip title="Run" placement="left">
                      <button
                        onClick={() => runScript(s)}
                        disabled={running !== null}
                        className="text-neutral-500 hover:text-green-400 disabled:opacity-30 transition-colors"
                      >
                        <PlayIcon size={13} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip title="Unpin" placement="left">
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => unpin(s.filename)}
                      className="hidden text-neutral-700 hover:text-neutral-400 group-hover:block"
                    >
                      <PinOffIcon size={11} />
                    </button>
                  </Tooltip>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Draggable>
  )
}