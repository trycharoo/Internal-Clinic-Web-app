FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter @clinic/frontend...
COPY apps/frontend ./apps/frontend
RUN pnpm --filter @clinic/frontend build

FROM nginx:stable-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
