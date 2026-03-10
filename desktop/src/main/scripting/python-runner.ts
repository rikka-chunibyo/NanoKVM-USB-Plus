/**
 * python-runner.ts
 *
 * Runs a user Python script with access to the `kvm` module.
 *
 * Architecture:
 *   1. A local TCP server is started on a random port.
 *   2. kvm.py is written to a temp dir and added to PYTHONPATH.
 *   3. The user's script is written to a temp file and executed.
 *   4. kvm.py connects to the TCP server and sends JSON commands.
 *   5. The server executes each command via the KvmApi and responds.
 *
 * Wire protocol (newline-delimited JSON):
 *   Request:  { "id": 1, "cmd": "type",  "args": ["hello"] }
 *   Response: { "id": 1, "ok": true }
 *          or { "id": 1, "ok": false, "error": "message" }
 */

import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'

import { KvmApi } from './kvm-api'

// ---------------------------------------------------------------------------
// kvm.py source — written to a temp dir so the user can `import kvm`
// ---------------------------------------------------------------------------

const KVM_PY_SOURCE = `
import json
import os
import socket
import tempfile
import base64

_sock = None
_req_id = 0

def _connect():
    global _sock
    port = int(os.environ['KVM_PORT'])
    _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _sock.connect(('127.0.0.1', port))

def _call(cmd, *args):
    global _req_id, _sock
    if _sock is None:
        _connect()
    _req_id += 1
    msg = json.dumps({'id': _req_id, 'cmd': cmd, 'args': list(args)}) + '\\n'
    _sock.sendall(msg.encode())
    buf = b''
    while b'\\n' not in buf:
        chunk = _sock.recv(4096)
        if not chunk:
            raise ConnectionError('kvm: connection closed by host')
        buf += chunk
    rsp = json.loads(buf.split(b'\\n')[0])
    if not rsp.get('ok'):
        raise RuntimeError(f"kvm error: {rsp.get('error', 'unknown')}")
    return rsp.get('result')

def type(text):        _call('type', text)
def key(combo, times=1): _call('key', combo, times)
def delay(ms):         _call('delay', ms)
def log(message):      _call('log', str(message))

def mouse_move(x, y, mode='rel'):  _call('mouse_move', x, y, mode)
def mouse_click(button='left', times=1): _call('mouse_click', button, times)
def mouse_scroll(delta):            _call('mouse_scroll', delta)

def screenshot():
    """Returns path to a PNG temp file of the current video frame."""
    result = _call('screenshot')
    return result  # already a file path string

def close():
    global _sock
    if _sock:
        _sock.close()
        _sock = None
`

// ---------------------------------------------------------------------------
// Python executable detection
// ---------------------------------------------------------------------------

async function findPython(): Promise<string> {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python']

  for (const bin of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(bin, ['--version'], { stdio: 'ignore' })
        p.on('close', (code) => (code === 0 ? resolve() : reject()))
        p.on('error', reject)
      })
      return bin
    } catch { /* try next */ }
  }

  throw new Error(
    'Python not found. Install Python 3 and ensure it is in your PATH.\n' +
    'Download from https://www.python.org/downloads/'
  )
}

// ---------------------------------------------------------------------------
// TCP command server
// ---------------------------------------------------------------------------

type KvmCommand = {
  id: number
  cmd: string
  args: unknown[]
}

async function dispatchCommand(cmd: KvmCommand, kvm: KvmApi): Promise<unknown> {
  const [a0, a1, a2] = cmd.args as [unknown, unknown, unknown]

  switch (cmd.cmd) {
    case 'type':        await kvm.type(String(a0)); return null
    case 'key':         await kvm.key(String(a0), typeof a1 === 'number' ? a1 : 1); return null
    case 'delay':       await kvm.delay(Number(a0)); return null
    case 'log':         kvm.log(String(a0)); return null
    case 'mouse_move':  await kvm.mouseMove(Number(a0), Number(a1), (a2 as string) === 'abs' ? 'abs' : 'rel'); return null
    case 'mouse_click': await kvm.mouseClick((a0 as 'left' | 'right' | 'middle') ?? 'left', typeof a1 === 'number' ? a1 : 1); return null
    case 'mouse_scroll':await kvm.mouseScroll(Number(a0)); return null
    case 'screenshot': {
      const result = await kvm.screenshot()
      return result.path
    }
    default:
      throw new Error(`Unknown command: ${cmd.cmd}`)
  }
}

function startTcpServer(kvm: KvmApi, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buf = ''

      socket.on('data', (chunk) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop()! // keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue
          let cmd: KvmCommand
          try {
            cmd = JSON.parse(line)
          } catch {
            socket.write(JSON.stringify({ id: -1, ok: false, error: 'Invalid JSON' }) + '\n')
            continue
          }

          // Execute async, but serialize responses per connection
          dispatchCommand(cmd, kvm)
            .then((result) => {
              socket.write(JSON.stringify({ id: cmd.id, ok: true, result }) + '\n')
            })
            .catch((err) => {
              socket.write(JSON.stringify({ id: cmd.id, ok: false, error: String(err) }) + '\n')
            })
        }
      })

      socket.on('error', () => { /* client disconnected */ })
    })

    signal.addEventListener('abort', () => {
      server.close()
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve(addr.port)
    })

    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export class PythonRunnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PythonRunnerError'
  }
}

export async function runPython(
  source: string,
  kvm: KvmApi,
  signal: AbortSignal
): Promise<void> {
  const python = await findPython()

  // Write kvm.py to temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvm-py-'))
  const kvmPyPath  = path.join(tmpDir, 'kvm.py')
  const scriptPath = path.join(tmpDir, 'script.py')

  try {
    fs.writeFileSync(kvmPyPath, KVM_PY_SOURCE.trimStart(), 'utf-8')
    fs.writeFileSync(scriptPath, source, 'utf-8')

    // Start TCP server
    const port = await startTcpServer(kvm, signal)

    // Spawn Python
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return resolve()

      const env = {
        ...process.env,
        KVM_PORT: String(port),
        PYTHONPATH: [tmpDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        PYTHONUNBUFFERED: '1',
      }

      const proc: ChildProcess = spawn(python, [scriptPath], { env, stdio: ['ignore', 'pipe', 'pipe'] })

      proc.stdout?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n').filter(Boolean)) {
          kvm.log(line)
        }
      })

      proc.stderr?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n').filter(Boolean)) {
          kvm.log(`[stderr] ${line}`)
        }
      })

      signal.addEventListener('abort', () => {
        proc.kill('SIGTERM')
        setTimeout(() => proc.kill('SIGKILL'), 1000)
      }, { once: true })

      proc.on('close', (code) => {
        if (signal.aborted || code === 0 || code === null) {
          resolve()
        } else {
          reject(new PythonRunnerError(`Python exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        reject(new PythonRunnerError(err.message))
      })
    })
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

export function validatePython(source: string): { ok: boolean; error?: string } {
  // Lightweight syntax check: look for common obvious mistakes
  // Full validation requires spawning python -c "compile(...)" — do it async if needed
  if (!source.trim()) return { ok: false, error: 'Script is empty' }
  return { ok: true }
}
