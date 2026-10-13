# Image générique pour une application de la suite.
# Build : docker build --build-arg APP=home -t workspace-home .
# Run   : docker run -p 3000:3000 --env-file .env workspace-home
FROM node:22-slim AS build
ARG APP=home
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN NITRO_PRESET=node-server pnpm turbo run build --filter=@app/${APP}

FROM node:22-slim
ARG APP=home
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /repo/apps/${APP}/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
