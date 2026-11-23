import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, session, shell } from 'electron'
import log from 'electron-log/main'

import icon from '../../resources/icon.png?asset'
import * as events from './events'

console.error = log.error

let mainWindow: BrowserWindow | undefined

function createWindow(): void {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.on('ready-to-show', () => {
    window.maximize()
    window.show()
  })

  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(console.error)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.rikka-chunibyo.nanokvm-usb-plus')

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowedPermissions = ['media', 'clipboard-read', 'pointerLock']
    callback(contents === mainWindow?.webContents && details.isMainFrame && allowedPermissions.includes(permission))
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  events.registerApp()
  events.registerFiles()
  events.registerSerialPort()

  createWindow()

  events.registerUpdater(() => mainWindow)
  events.registerScripting(() => mainWindow)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
