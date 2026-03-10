export const IpcEvents = {
  // App
  GET_APP_VERSION: 'get-app-version',
  GET_PLATFORM: 'get-platform',
  OPEN_EXTERNAL_RUL: 'open-external-url',
  CHECK_MEDIA_PERMISSION: 'check-media-permission',
  REQUEST_MEDIA_PERMISSION: 'request-media-permission',
  SET_FULL_SCREEN: 'set-full-screen',

  // Serial port
  GET_SERIAL_PORTS: 'get-serial-ports',
  OPEN_SERIAL_PORT: 'open-serial-port',
  OPEN_SERIAL_PORT_RSP: 'open-serial-port-rsp',
  CLOSE_SERIAL_PORT: 'close-serial-port',
  SERIAL_PORT_DISCONNECTED: 'serial-port-disconnected',
  SEND_KEYBOARD: 'send-keyboard',
  SEND_MOUSE: 'send-mouse',

  // Updater
  CHECK_FOR_UPDATES: 'check-for-updates',
  DOWNLOAD_UPDATE: 'download-update',
  UPDATE_AVAILABLE: 'update-available',
  UPDATE_NOT_AVAILABLE: 'update-not-available',
  UPDATE_ERROR: 'update-error',
  DOWNLOAD_PROGRESS: 'download-progress',
  UPDATE_DOWNLOADED: 'update-downloaded',

  // File saving
  GET_DOWNLOADS_DIR:        'get-downloads-dir',
  OPEN_DIR_PICKER:          'open-dir-picker',
  SAVE_SCREENSHOT:          'save-screenshot',
  OPEN_SAVE_DIALOG:         'open-save-dialog',
  OPEN_VIDEO_WRITE_STREAM:  'open-video-write-stream',
  WRITE_VIDEO_CHUNK:        'write-video-chunk',
  CLOSE_VIDEO_WRITE_STREAM: 'close-video-write-stream',

  // Screenshot — main asks renderer to capture a video frame
  SCRIPT_SCREENSHOT_REQUEST:  'script-screenshot-request',
  SCRIPT_SCREENSHOT_RESPONSE: 'script-screenshot-response',

  // Scripting — invoke (renderer → main)
  SCRIPT_RUN:         'script-run',
  SCRIPT_PAUSE:       'script-pause',
  SCRIPT_RESUME:      'script-resume',
  SCRIPT_STOP:        'script-stop',
  SCRIPT_STATUS:      'script-status',
  SCRIPT_VALIDATE:    'script-validate',
  SCRIPT_SAVE:        'script-save',
  SCRIPT_LOAD:        'script-load',
  SCRIPT_DELETE:      'script-delete',
  SCRIPT_LIST:        'script-list',
  SCRIPT_SET_OPTIONS: 'script-set-options',

  // Scripting — events (main → renderer)
  SCRIPT_PROGRESS: 'script-progress',
  SCRIPT_ERROR:    'script-error',
  SCRIPT_LOG:      'script-log',
} as const

export type IpcEventName = (typeof IpcEvents)[keyof typeof IpcEvents]