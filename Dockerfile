FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
# External analytics keys are baked into the client bundle at build time;
# pass them with `fly deploy --build-arg VITE_...=...` (all optional).
ARG VITE_UMAMI_WEBSITE_ID
ARG VITE_UMAMI_SRC
ARG VITE_GA_GAME_KEY
ARG VITE_GA_SECRET_KEY
ENV VITE_UMAMI_WEBSITE_ID=$VITE_UMAMI_WEBSITE_ID \
    VITE_UMAMI_SRC=$VITE_UMAMI_SRC \
    VITE_GA_GAME_KEY=$VITE_GA_GAME_KEY \
    VITE_GA_SECRET_KEY=$VITE_GA_SECRET_KEY
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
EXPOSE 3000
CMD ["node", "server/dist/server.js"]
