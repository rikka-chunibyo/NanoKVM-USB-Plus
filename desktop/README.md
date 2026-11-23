# NanoKVM-USB Plus Desktop

This is the NanoKVM-USB Plus desktop version project.

## Development

```shell
cd desktop
npm ci
npm run dev
```

## Compile

```shell
# For Windows
npm run build:win

# For MacOS
npm run build:mac

# For Linux
npm run build:linux
```

## Script permissions

Run JavaScript and Python scripts only from sources you trust. Both run with your
local user permissions and can access the host's files as well as the KVM.

## GitHub releases

For a new release, commit the new version in this directory's `package.json` and
`package-lock.json`. Run **Create Tag and Release** from `main`. The workflow
builds the browser bundle and desktop installers in a draft before publishing
them. Run it again with the same commit and prerelease setting to retry a failed
build.

macOS signing uses `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` when
configured. Notarization also requires `APPLE_ID`, `APPLE_TEAM_ID`, and
`APPLE_APP_SPECIFIC_PASSWORD`.
