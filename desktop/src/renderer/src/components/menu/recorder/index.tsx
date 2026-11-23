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
  const startingRef      = useRef(false)
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

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stopTimer()
  }, [])

  const formatElapsed = (ms: number) => {
    const total = Math.floor(ms / 1000)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  const handleStartRecording = async (e: React.MouseEvent) => {
    const stream = camera.getStream()
    if (!stream || startingRef.current || mediaRecorderRef.current) return
    startingRef.current = true
    let openedStream: string | undefined

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

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      const openResult = await window.electron.ipcRenderer.invoke(IpcEvents.OPEN_VIDEO_WRITE_STREAM, filePath)
      if (!openResult.ok) throw new Error(openResult.error)
      const streamId = openResult.streamId as string
      openedStream = streamId

      let queuedWrites = Promise.resolve()
      let writeFailed = false
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        queuedWrites = queuedWrites.then(async () => {
          if (writeFailed) return
          const base64 = await blobToBase64(event.data)
          const result = await window.electron.ipcRenderer.invoke(IpcEvents.WRITE_VIDEO_CHUNK, streamId, base64)
          if (!result.ok) throw new Error(result.error)
        }).catch((error) => {
          writeFailed = true
          console.error('Could not write recording:', error)
          if (recorder.state !== 'inactive') recorder.stop()
        })
      }

      recorder.onstop = async () => {
        try {
          await queuedWrites
          const result = await window.electron.ipcRenderer.invoke(IpcEvents.CLOSE_VIDEO_WRITE_STREAM, streamId)
          if (!result.ok) throw new Error(result.error)
        } catch (error) {
          console.error('Could not finish recording:', error)
        } finally {
          mediaRecorderRef.current = undefined
          stopTimer()
          setElapsedMs(0)
          setIsRecording(false)
        }
      }

      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      startTimer()
    } catch (error) {
      console.error(error)
      if (openedStream) {
        await window.electron.ipcRenderer.invoke(IpcEvents.CLOSE_VIDEO_WRITE_STREAM, openedStream).catch(console.error)
      }
    } finally {
      startingRef.current = false
    }
  }

  const handleStopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  const tooltipTitle = (
    <span>
      Record&nbsp;
      <span className="text-neutral-400 text-xs">Shift+click to choose location</span>
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
    <Tooltip title={tooltipTitle} placement="bottom" overlayStyle={{ maxWidth: 260 }}>
      <div
        className="flex h-[28px] cursor-pointer items-center justify-center rounded px-2 text-white hover:bg-neutral-700/70"
        onClick={handleStartRecording}
      >
        <Video size={18} />
      </div>
    </Tooltip>
  )
}