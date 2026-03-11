import { clipboard } from 'electron'
import { Device } from '../device'
import { buildKeyboardReport, charToKeyCombo, KEY_UP_REPORT, parseKeyCombo } from './keycodes'

export type MouseButton = 'left' | 'right' | 'middle'
export type LogFn = (message: string) => void
export type ScreenshotResult = { base64: string; width: number; height: number; path: string }
export type ScreenshotFn = () => Promise<ScreenshotResult>

export interface KvmApi {
  type(text: string): Promise<void>
  key(combo: string, times?: number): Promise<void>
  mouseMove(x: number, y: number, mode?: 'rel' | 'abs'): Promise<void>
  mouseClick(button?: MouseButton, times?: number): Promise<void>
  mouseScroll(delta: number): Promise<void>
  delay(ms: number): Promise<void>
  screenshot(): Promise<ScreenshotResult>
  clipboard(): Promise<string>
  log(message: string): void
  typeDelay: number
  keyPressDelay: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function mouseRel(btn: number, dx: number, dy: number, scroll: number): number[] {
  return [0x01, btn, dx & 0xff, dy & 0xff, scroll & 0xff]
}

function mouseAbs(btn: number, x: number, y: number): number[] {
  return [0x02, btn, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff]
}

const BTN: Record<MouseButton, number> = { left: 0x01, right: 0x02, middle: 0x04 }

export function createKvmApi(device: Device, logFn: LogFn, screenshotFn: ScreenshotFn): KvmApi {
  const api: KvmApi = {
    typeDelay: 30,
    keyPressDelay: 20,

    async type(text) {
      for (const char of text) {
        const { modifier, keycode } = charToKeyCombo(char)
        await device.sendKeyboardData(buildKeyboardReport(modifier, keycode))
        await sleep(api.keyPressDelay)
        await device.sendKeyboardData(KEY_UP_REPORT)
        if (api.typeDelay > 0) await sleep(api.typeDelay)
      }
    },

    async key(combo, times = 1) {
      const { modifier, keycode } = parseKeyCombo(combo)
      for (let t = 0; t < times; t++) {
        await device.sendKeyboardData(buildKeyboardReport(modifier, keycode))
        await sleep(api.keyPressDelay)
        await device.sendKeyboardData(KEY_UP_REPORT)
        if (t < times - 1) await sleep(api.keyPressDelay)
      }
    },

    async mouseMove(x, y, mode = 'rel') {
      await device.sendMouseData(mode === 'abs' ? mouseAbs(0, x, y) : mouseRel(0, x, y, 0))
    },

    async mouseClick(button = 'left', times = 1) {
      const btn = BTN[button]
      for (let t = 0; t < times; t++) {
        await device.sendMouseData(mouseRel(btn, 0, 0, 0))
        await sleep(api.keyPressDelay)
        await device.sendMouseData(mouseRel(0, 0, 0, 0))
        if (t < times - 1) await sleep(80)
      }
    },

    async mouseScroll(delta) {
      await device.sendMouseData(mouseRel(0, 0, 0, delta))
    },

    async delay(ms) { await sleep(ms) },

    async screenshot() { return screenshotFn() },

    async clipboard() { return clipboard.readText() },

    log(message) { logFn(message) },
  }
  return api
}