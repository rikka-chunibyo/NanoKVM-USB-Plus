/**
 * js-runner.ts
 *
 * Runs user JavaScript in a Node vm context.
 * Top-level await is supported.
 * require() is available via createRequire — scripts can use any installed package.
 */

import vm from 'vm'
import path from 'path'
import { createRequire } from 'module'
import { app } from 'electron'

import { KvmApi } from './kvm-api'

export class JsRunnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsRunnerError'
  }
}

function compile(source: string): vm.Script {
  return new vm.Script('(async function __kvm__() {\n' + source + '\n})()', {
    filename: 'kvm-script.js'
  })
}

export async function runJavaScript(
  source: string,
  kvm: KvmApi,
  signal: AbortSignal
): Promise<void> {
  // require() resolves relative to the user's scripts directory
  const scriptsDir = path.join(app.getPath('userData'), 'scripts')
  const vmRequire = createRequire(path.join(scriptsDir, '__script__.js'))

  const context = vm.createContext({
    kvm,
    require: vmRequire,
    // Node globals scripts are likely to want
    Buffer,
    process: { env: process.env, platform: process.platform, versions: process.versions },
    console: {
      log:   (...a: unknown[]) => kvm.log(a.map(String).join(' ')),
      warn:  (...a: unknown[]) => kvm.log('[warn] '  + a.map(String).join(' ')),
      error: (...a: unknown[]) => kvm.log('[error] ' + a.map(String).join(' ')),
      info:  (...a: unknown[]) => kvm.log('[info] '  + a.map(String).join(' ')),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    _abortSignal: signal,
  })

  let script: vm.Script
  try {
    script = compile(source)
  } catch (err) {
    throw new JsRunnerError(`Syntax error: ${(err as Error).message}`)
  }

  signal.throwIfAborted()
  let cancel: (() => void) | undefined
  try {
    const scriptPromise = script.runInContext(context, { timeout: 5000 }) as Promise<void>
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(new JsRunnerError('Script stopped'))
      signal.addEventListener('abort', cancel, { once: true })
      void scriptPromise.then(resolve, reject)
    })
  } catch (error) {
    throw new JsRunnerError(error instanceof Error ? error.message : String(error))
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel)
  }
}

export function validateJavaScript(source: string): { ok: boolean; error?: string } {
  try {
    compile(source)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
