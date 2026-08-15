#  The portal is a static page plus the small proxy that holds the key.
#  Node 24 runs the TypeScript directly, so there is no build step for the
#  server — only for the page.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
#  Only what the server needs: the built page, the handlers, and the SDK.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
EXPOSE 3001
CMD ["node", "server/serve.ts"]
