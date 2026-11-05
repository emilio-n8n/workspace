# Image générique pour une application de la suite.
# Build : docker build --build-arg APP=home -t workspace-home .
# Run   : docker run -p 3000:3000 --env-file .env workspace-home
FROM node:22-slim AS deps
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP=home
RUN NITRO_PRESET=node-server pnpm turbo run build --filter=@app/${APP}

# Cible « migrate » : conserve le dépôt et les dépendances pour appliquer les
# migrations sans construire une application.
FROM deps AS migrate
WORKDIR /repo
CMD ["pnpm", "db:migrate"]

FROM node:22-slim AS runtime
ARG APP=home
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /repo/apps/${APP}/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
