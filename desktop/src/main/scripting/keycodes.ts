/**
 * USB HID Keyboard Usage IDs (page 0x07)
 * Modifier byte flags for HID keyboard reports.
 */

export const Modifiers = {
  NONE: 0x00,
  LEFT_CTRL: 0x01,
  LEFT_SHIFT: 0x02,
  LEFT_ALT: 0x04,
  LEFT_META: 0x08,
  RIGHT_CTRL: 0x10,
  RIGHT_SHIFT: 0x20,
  RIGHT_ALT: 0x40,
  RIGHT_META: 0x80
} as const

/** Map from lowercase key name → HID usage ID */
export const KeyCode: Record<string, number> = {
  // Letters
  a: 0x04, b: 0x05, c: 0x06, d: 0x07, e: 0x08, f: 0x09,
  g: 0x0a, h: 0x0b, i: 0x0c, j: 0x0d, k: 0x0e, l: 0x0f,
  m: 0x10, n: 0x11, o: 0x12, p: 0x13, q: 0x14, r: 0x15,
  s: 0x16, t: 0x17, u: 0x18, v: 0x19, w: 0x1a, x: 0x1b,
  y: 0x1c, z: 0x1d,

  // Numbers
  '1': 0x1e, '2': 0x1f, '3': 0x20, '4': 0x21, '5': 0x22,
  '6': 0x23, '7': 0x24, '8': 0x25, '9': 0x26, '0': 0x27,

  // Special / whitespace
  enter: 0x28, return: 0x28,
  escape: 0x29, esc: 0x29,
  backspace: 0x2a,
  tab: 0x2b,
  space: 0x2c,
  ' ': 0x2c,

  // Punctuation (unshifted)
  '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30, '\\': 0x31,
  ';': 0x33, "'": 0x34, '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38,

  // F-keys
  f1: 0x3a, f2: 0x3b, f3: 0x3c, f4: 0x3d, f5: 0x3e,
  f6: 0x3f, f7: 0x40, f8: 0x41, f9: 0x42, f10: 0x43,
  f11: 0x44, f12: 0x45,

  // Navigation
  insert: 0x49, delete: 0x4c, del: 0x4c,
  home: 0x4a, end: 0x4d,
  pageup: 0x4b, pagedown: 0x4e,
  right: 0x4f, left: 0x50, down: 0x51, up: 0x52,

  // Lock keys
  capslock: 0x39, numlock: 0x53, scrolllock: 0x47,

  // Numpad
  'num0': 0x62, 'num1': 0x59, 'num2': 0x5a, 'num3': 0x5b,
  'num4': 0x5c, 'num5': 0x5d, 'num6': 0x5e, 'num7': 0x5f,
  'num8': 0x60, 'num9': 0x61,
  'num.': 0x63, 'num/': 0x54, 'num*': 0x55, 'num-': 0x56, 'num+': 0x57,
  'numenter': 0x58,

  // Printscreen / pause
  printscreen: 0x46, pause: 0x48,

  // Modifier keys as standalone (for key-down/up if needed)
  ctrl: 0xe0, control: 0xe0,
  shift: 0xe1,
  alt: 0xe2,
  meta: 0xe3, win: 0xe3, cmd: 0xe3, super: 0xe3,
  rctrl: 0xe4, rshift: 0xe5, ralt: 0xe6, rmeta: 0xe7
}

/** Characters that require Shift on a US QWERTY layout */
const shiftedChars: Record<string, string> = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
  ':': ';', '"': "'", '~': '`', '<': ',', '>': '.', '?': '/'
}

export type KeyCombo = { modifier: number; keycode: number }

/**
 * Parse a key combo string like "ctrl+shift+a" into modifier byte + HID keycode.
 * Modifier-only combos (e.g. "ctrl+c") are fully supported.
 */
export function parseKeyCombo(combo: string): KeyCombo {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim())
  let modifier = Modifiers.NONE
  let keycode = 0x00

  const modifierMap: Record<string, number> = {
    ctrl: Modifiers.LEFT_CTRL, control: Modifiers.LEFT_CTRL,
    shift: Modifiers.LEFT_SHIFT,
    alt: Modifiers.LEFT_ALT,
    meta: Modifiers.LEFT_META, win: Modifiers.LEFT_META,
    cmd: Modifiers.LEFT_META, super: Modifiers.LEFT_META,
    rctrl: Modifiers.RIGHT_CTRL, rshift: Modifiers.RIGHT_SHIFT,
    ralt: Modifiers.RIGHT_ALT, rmeta: Modifiers.RIGHT_META
  }

  for (const part of parts) {
    if (modifierMap[part] !== undefined) {
      modifier |= modifierMap[part]
    } else {
      keycode = KeyCode[part] ?? 0x00
    }
  }

  return { modifier, keycode }
}

/**
 * Convert a single printable character into a KeyCombo, handling shift.
 */
export function charToKeyCombo(char: string): KeyCombo {
  const lower = char.toLowerCase()

  // If it's an uppercase letter, add shift
  if (char !== lower && KeyCode[lower] !== undefined) {
    return { modifier: Modifiers.LEFT_SHIFT, keycode: KeyCode[lower] }
  }

  // If it's a shifted punctuation character
  if (shiftedChars[char] !== undefined) {
    const base = shiftedChars[char]
    return { modifier: Modifiers.LEFT_SHIFT, keycode: KeyCode[base] ?? 0x00 }
  }

  return { modifier: Modifiers.NONE, keycode: KeyCode[char] ?? KeyCode[lower] ?? 0x00 }
}

/** Build a standard 8-byte HID keyboard report */
export function buildKeyboardReport(modifier: number, keycode: number): number[] {
  return [modifier, 0x00, keycode, 0x00, 0x00, 0x00, 0x00, 0x00]
}

/** An empty (key-up) keyboard report */
export const KEY_UP_REPORT: number[] = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
