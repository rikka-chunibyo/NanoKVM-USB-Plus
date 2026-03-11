/**
 * components/script/sidebar.tsx
 */

import { ReactElement, useEffect, useRef, useState } from 'react'
import { Tooltip } from 'antd'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable'
import {
  ChevronLeftIcon, ChevronRightIcon,
  CircleStopIcon, FileCodeIcon, GripVerticalIcon,
  PlayIcon,
} from 'lucide-react'

import { IpcEvents, KVM_PINS_CHANGED } from '@common/ipc-events'
import { serialPortStateAtom, videoStateAtom } from '@renderer/jotai/device'
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
  } catch {}
  return { x: window.innerWidth - 180, y: Math.max(60, window.innerHeight / 2 - 80) }
}

function savePos(pos: Pos): void {
  localStorage.setItem(SIDEBAR_POS_KEY, JSON.stringify(pos))
}

export const ScriptSidebar = (): ReactElement | null => {
  const videoState      = useAtomValue(videoStateAtom)
  const serialPortState = useAtomValue(serialPortStateAtom)

  const [pins, setPins]           = useState<string[]>(getSidebarPins)
  const [scripts, setScripts]     = useState<SavedScript[]>([])
  const [running, setRunning]     = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos]             = useState<Pos>(loadPos)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [ghostPos, setGhostPos]   = useState<{ x: number; y: number } | null>(null)

  const fromRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nodeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function sync(): void { setPins(getSidebarPins()) }
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    window.addEventListener(KVM_PINS_CHANGED, sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener(KVM_PINS_CHANGED, sync)
    }
  }, [])

  useEffect(() => {
    if (pins.length === 0) { setScripts([]); return }
    window.electron.ipcRenderer
      .invoke(IpcEvents.SCRIPT_LIST)
      .then((list: SavedScript[]) => {
        const byFilename = Object.fromEntries(list.map((s) => [s.filename, s]))
        setScripts(pins.map((f) => byFilename[f]).filter(Boolean) as SavedScript[])
      })
  }, [pins])

  useEffect(() => {
    const rm = window.electron.ipcRenderer.on(IpcEvents.SCRIPT_PROGRESS, (_, p) => {
      if (p.status === 'idle' || p.status === 'done' || p.status === 'error') setRunning(null)
    })
    return rm
  }, [])

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

  // ── SWAP ON DROP ──────────────────────────────────────────────
  function onRowGripMouseDown(index: number, e: React.MouseEvent): void {
    e.preventDefault()
    fromRef.current = index
    setDragIndex(index)
    setGhostPos({ x: e.clientX, y: e.clientY })

    function onMove(ev: MouseEvent): void {
      setGhostPos({ x: ev.clientX, y: ev.clientY })
    }

    function onUp(ev: MouseEvent): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      const from = fromRef.current
      let to: number | null = null

      if (listRef.current) {
        const rows = Array.from(
          listRef.current.querySelectorAll<HTMLElement>('[data-row]')
        )

        // 1️⃣ DOM hit test
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const rowEl = el?.closest<HTMLElement>('[data-row]')

        if (rowEl?.dataset.row) {
          to = Number(rowEl.dataset.row)
        } else if (rows.length > 0) {
          // 2️⃣ Fallback: nearest row center
          let bestDist = Infinity
          let bestIndex = 0

          for (const row of rows) {
            const rect = row.getBoundingClientRect()
            const centerY = rect.top + rect.height / 2
            const dist = Math.abs(ev.clientY - centerY)
            const idx = Number(row.dataset.row)

            if (dist < bestDist) {
              bestDist = dist
              bestIndex = idx
            }
          }

          to = bestIndex
        }
      }

      // 🔁 TRUE SWAP (based on visible scripts)
      if (from != null && to != null && from !== to) {
        setPins(prev => {
          const next = [...prev]

          const fromFile = scripts[from].filename
          const toFile   = scripts[to].filename

          const fromPinIndex = next.indexOf(fromFile)
          const toPinIndex   = next.indexOf(toFile)

          ;[next[fromPinIndex], next[toPinIndex]] =
            [next[toPinIndex], next[fromPinIndex]]

          setSidebarPins(next)
          window.dispatchEvent(new CustomEvent(KVM_PINS_CHANGED))
          return next
        })
      }

      fromRef.current = null
      setDragIndex(null)
      setGhostPos(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (pins.length === 0 || videoState !== 'connected' || serialPortState !== 'connected') return null

  const ghostScript = dragIndex !== null ? scripts[dragIndex] : null

  return (
    <>
      {ghostPos && ghostScript && (
        <div
          className="pointer-events-none fixed z-[9999] flex items-center gap-1 rounded-lg border border-blue-500/40 bg-neutral-800/95 px-1.5 py-1 shadow-lg backdrop-blur-sm"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <span className={clsx('rounded border px-1 py-0.5 text-[9px] font-mono', LANG_COLOR[ghostScript.type])}>
            {ghostScript.type === 'dsl' ? 'D' : ghostScript.type === 'js' ? 'J' : 'P'}
          </span>
          <span className="max-w-[100px] truncate text-xs text-neutral-200">{ghostScript.displayName}</span>
        </div>
      )}

      <Draggable
        nodeRef={nodeRef}
        handle=".sidebar-grip"
        defaultPosition={pos}
        onStop={onDragStop}
        bounds="parent"
      >
        <div
          ref={nodeRef}
          className="fixed z-[990] flex w-44 flex-col rounded-xl border border-neutral-700/60 bg-neutral-900/95 shadow-xl backdrop-blur-sm"
        >
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

          {!collapsed && (
            <div ref={listRef} className="flex flex-col gap-0.5 px-1.5 pb-1.5">
              {scripts.map((s, index) => {
                const isThis     = running === s.filename
                const isDragging = dragIndex === index

                return (
                  <div
                    key={s.filename}
                    data-row={index}
                    className={clsx(
                      'group flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors',
                      isThis ? 'bg-blue-600/20' : 'hover:bg-neutral-800',
                      isDragging ? 'opacity-30' : 'opacity-100'
                    )}
                  >
                    <div
                      className="shrink-0 cursor-grab select-none text-neutral-700 hover:text-neutral-500 active:cursor-grabbing"
                      onMouseDown={(e) => onRowGripMouseDown(index, e)}
                    >
                      <GripVerticalIcon size={10} />
                    </div>

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
                        <button onClick={() => stopScript()} className="shrink-0 text-red-400 hover:text-red-300">
                          <CircleStopIcon size={13} />
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Run" placement="left">
                        <button
                          onClick={() => runScript(s)}
                          disabled={running !== null}
                          className="shrink-0 text-neutral-500 hover:text-green-400 disabled:opacity-30 transition-colors"
                        >
                          <PlayIcon size={13} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Draggable>
    </>
  )
}