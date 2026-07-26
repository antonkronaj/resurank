# Build context is the REPO ROOT, not this directory:
#   docker build -f apps/web/Dockerfile -t resurank-server .
#
# The server is auth + Postgres CRUD + email + static hosting. It performs no
# ML — embedding and scoring run client-side in the browser — so no ONNX
# runtime or model weights are installed here.

# Every stage needs the workspace manifests up front so `npm ci` can resolve
# the lockfile; they are copied before the sources to keep that layer cached.
FROM node:22-alpine AS manifests
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/scoring/package.json packages/scoring/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY apps/web/package.json apps/web/
COPY frontend/package.json frontend/

# Runtime dependency closure — installed separately from the build toolchain so
# the final image never sees it. Scoped to the apps/web workspace on purpose:
# a plain `--omit=dev` at the root would still drag in @angular/*,
# @huggingface/transformers and pdfjs-dist, because those are *dependencies* of
# the frontend workspace, not devDependencies. The workspace root is excluded
# too — its deps are Electron's (electron-updater, electron-squirrel-startup).
#
# The ONNX tree is then pruned by hand. @huggingface/transformers is a
# devDependency of packages/scoring (it needs it to build and test the
# ./node-embedder subpath), and npm installs a *linked workspace's*
# devDependencies even under --omit=dev — no combination of --omit=dev/peer/
# optional removes it, and --install-links still symlinks the workspace. It is
# unreachable from this image: the server performs no ML, and it imports only
# scoring's main entry, which has no transformers import. The build stage below
# asserts that stays true, so this prune fails loudly instead of silently
# shipping a broken image if the server ever grows a server-side embedder.
FROM manifests AS prod-deps
# argon2 compiles a native addon; alpine needs a toolchain to build it.
RUN apk add --no-cache python3 make g++
RUN npm ci --omit=dev --workspace apps/web \
 && rm -rf node_modules/@huggingface \
           node_modules/onnxruntime-node \
           node_modules/onnxruntime-web \
           node_modules/onnxruntime-common \
           node_modules/sharp \
           node_modules/@img

FROM manifests AS build
RUN apk add --no-cache python3 make g++
RUN npm ci

COPY . .

# Guards the ONNX prune in the prod-deps stage. If the server ever imports the
# node-embedder subpath it needs @huggingface/transformers at runtime, and the
# pruned image would fail on first request instead of here.
RUN if grep -rq "@resurank/scoring/node-embedder" apps/web/src; then \
      echo "ERROR: apps/web imports @resurank/scoring/node-embedder, which needs the" >&2; \
      echo "ONNX runtime pruned in the prod-deps stage. Drop that prune before shipping." >&2; \
      exit 1; \
    fi

RUN npm run build:scoring \
 && npm --prefix apps/web run build \
 && npm run build:frontend:web

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=prod-deps /repo/node_modules ./node_modules
# apps/web pins zod ^3 while another workspace pulls zod 4 to the hoisted root,
# so npm nests the correct copy here and `npm ci` reproduces that nesting. Without
# this the server resolves the root's zod 4 and its schemas misbehave at runtime.
COPY --from=prod-deps /repo/apps/web/node_modules ./apps/web/node_modules
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
