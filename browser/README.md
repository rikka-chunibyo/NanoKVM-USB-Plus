# NanoKVM-USB Plus Browser

This is the NanoKVM-USB Plus browser version project.

Online website: [usbkvm.sipeed.com](https://usbkvm.sipeed.com).

## Development

```shell
cd browser
pnpm install
pnpm dev
```

## Deployment

1. Execute `pnpm build` to build the project.
2. Execute `pnpm install -g http-server` to install http-server.
3. Execute `cd dist` to change working directory to `dist/` .
4. Execute `http-server -p 8080 -a localhost` to run the service.
5. Open the Chrome browser and visit `http://localhost:8080`.

### Deploy in Docker (HAS NOT BEEN UPDATED FOR PLUS)

```shell
git clone https://github.com/rikka-chunibyo/NanoKVM-USB-Plus.git
cd NanoKVM-USB-Plus
docker-compose up -d
```

Then visit `http://localhost:9000` in your browser.
