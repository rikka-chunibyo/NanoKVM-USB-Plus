/**
 * components/recorder/index.tsx
 *
 * Normal click  → saves directly to configured video directory (auto-named).
 * Shift + click → shows Electron save dialog to choose exact file path.
 */

import { useEffect, useRef, useState } from 'react'
import { Tooltip } from 'antd'
import { Video } from 'lucide-react'

import { IpcEvents } from '@common/ipc-events'
import { camera } from '@renderer/libs/media/camera'
import { getVideoSavePath } from '@renderer/libs/storage'

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export const Recorder = () => {
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedMs, setElapsedMs]     = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder>()
  const streamIdRef      = useRef<string | null>(null)
  const timerRef         = useRef<number | null>(null)
  const startTimeRef     = useRef<number>(0)

  const stopTimer = () => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null }
  }
  const startTimer = () => {
    stopTimer()
    startTimeRef.current = Date.now()
    setElapsedMs(0)
    timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 1000)
  }

  useEffect(() => () => { stopTimer() }, [])

  const formatElapsed = (ms: number) => {
    const total = Math.floor(ms / 1000)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  const handleStartRecording = async (e: React.MouseEvent) => {
    const stream = camera.getStream()
    if (!stream) return

    try {
      const suggestedName = `recording-${timestamp()}.webm`
      let filePath: string | null = null

      if (e.shiftKey) {
        const downloadsDir = await window.electron.ipcRenderer.invoke(IpcEvents.GET_DOWNLOADS_DIR)
        filePath = await window.electron.ipcRenderer.invoke(IpcEvents.OPEN_SAVE_DIALOG, {
          defaultPath: `${downloadsDir}/${suggestedName}`,
          filters: [{ name: 'WebM Video', extensions: ['webm'] }],
        })
        if (!filePath) return
      } else {
        const dir = getVideoSavePath()
        const resolvedDir = dir || await window.electron.ipcRenderer.invoke(IpcEvents.GET_DOWNLOADS_DIR)
        filePath = `${resolvedDir}/${suggestedName}`.replace(/\\/g, '/')
      }

      const openResult = await window.electron.ipcRenderer.invoke(IpcEvents.OPEN_VIDEO_WRITE_STREAM, filePath)
      if (!openResult.ok) { console.error('Could not open stream:', openResult.error); return }
      streamIdRef.current = openResult.streamId

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0) return
        if (!streamIdRef.current) { recorder.stop(); return }
        const b64 = await blobToBase64(event.data)
        await window.electron.ipcRenderer.invoke(IpcEvents.WRITE_VIDEO_CHUNK, streamIdRef.current, b64)
      }

      recorder.onstop = async () => {
        if (streamIdRef.current) {
          await window.electron.ipcRenderer.invoke(IpcEvents.CLOSE_VIDEO_WRITE_STREAM, streamIdRef.current)
          streamIdRef.current = null
        }
        stopTimer(); setElapsedMs(0); setIsRecording(false)
      }

      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      startTimer()
    } catch (err) {
      console.error(err)
    }
  }

  const handleStopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); stopTimer(); setElapsedMs(0); setIsRecording(false)
    }
  }

  const tooltipTitle = (
    <span>
      Record
      <span className="ml-1.5 text-neutral-400 text-xs">(Shift+click to choose location)</span>
    </span>
  )

  if (isRecording) {
    return (
      <div
        className="flex h-[28px] min-w-[28px] cursor-pointer items-center justify-center space-x-1 rounded px-1 text-white hover:bg-neutral-700/70"
        onClick={handleStopRecording}
      >
        <Video className="animate-pulse text-red-400" size={18} />
        <span className="text-xs text-red-300">{formatElapsed(elapsedMs)}</span>
      </div>
    )
  }

  return (
    <Tooltip title={tooltipTitle} placement="bottom">
      <div
        className="flex h-[28px] cursor-pointer items-center justify-center rounded px-2 text-white hover:bg-neutral-700/70"
        onClick={handleStartRecording}
      >
        <Video size={18} />
      </div>
    </Tooltip>
  )
}
