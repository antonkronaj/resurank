# Build context is the REPO ROOT, not this directory:
#   docker build -f apps/web/Dockerfile -t resurank-server .
#
# The server is auth + Postgres CRUD + email + static hosting. It performs no
# ML — embedding and scoring run client-side in the browser — so no ONNX
# runtime or model weights are installed here.

FROM node:22-alpine AS build
WORKDIR /repo

# argon2 compiles a native addon; alpine needs a toolchain to build it.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/scoring/package.json packages/scoring/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY apps/web/package.json apps/web/
COPY frontend/package.json frontend/
RUN npm ci

COPY . .
RUN npm run build:scoring \
 && npm --prefix apps/web run build \
 && npm run build:frontend:web

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/scoring/dist packages/scoring/dist
COPY --from=build /repo/packages/scoring/package.json packages/scoring/package.json
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY --from=build /repo/apps/web/package.json apps/web/package.json
COPY --from=build /repo/apps/web/drizzle apps/web/drizzle
COPY --from=build /repo/frontend/dist/frontend frontend/dist/frontend

USER node
EXPOSE 3001

# Apply pending migrations on deploy before serving:
#   node apps/web/dist/db/migrate.js
CMD ["node", "apps/web/dist/index.js"]
