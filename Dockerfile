FROM node:22-alpine AS frontend
WORKDIR /app

COPY browser/package.json browser/pnpm-lock.yaml browser/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY browser/ ./
RUN pnpm build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend /app/dist/ /usr/share/nginx/html/
