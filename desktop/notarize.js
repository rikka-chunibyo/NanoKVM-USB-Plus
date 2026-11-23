const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { APPLE_TEAM_ID, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env
  if (!APPLE_TEAM_ID || !APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD) return

  const appName = context.packager.appInfo.productFilename

  return await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    teamId: APPLE_TEAM_ID,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD
  })
}
