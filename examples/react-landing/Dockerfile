#  The portal is a static page plus the small proxy that holds the key.
#  Node 24 runs the TypeScript directly, so there is no build step for the
#  server — only for the page.
#
#  Built from the REPO ROOT (docker build -f examples/react-landing/Dockerfile
#  … .), not from the landing dir, because the build-time generators in
#  scripts/gen-reference.ts and gen-wire.ts read SDK sources that live outside
#  the landing: packages/typescript/src/generated/ (the reference) and
#  contract/SCENARIOS.md + the five per-language runners (the wire page). Those
#  are placed at /app so the generators' `../../..` from …/scripts resolves to
#  /app, matching the repo layout.
FROM node:24-alpine AS build
WORKDIR /app/examples/react-landing

#  Landing deps first, for the layer cache.
COPY examples/react-landing/package.json examples/react-landing/package-lock.json ./
RUN npm ci

#  The landing itself.
COPY examples/react-landing/ ./

#  Sources the generators read at build time (outside the landing dir).
COPY packages/typescript/src/generated/ /app/packages/typescript/src/generated/
COPY contract/SCENARIOS.md /app/contract/SCENARIOS.md
COPY contract/runners/ /app/contract/runners/
COPY packages/rust/examples/contract.rs /app/packages/rust/examples/contract.rs
COPY packages/swift/Sources/UARPContract/ /app/packages/swift/Sources/UARPContract/
COPY packages/kotlin/uarp-sdk/src/test/kotlin/ai/snaga/uarp/ContractRunner.kt /app/packages/kotlin/uarp-sdk/src/test/kotlin/ai/snaga/uarp/ContractRunner.kt
COPY packages/ada/examples/src/contract.adb /app/packages/ada/examples/src/contract.adb

RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
#  Only what the server needs: the built page, the handlers, and the SDK.
COPY --from=build /app/examples/react-landing/dist ./dist
COPY --from=build /app/examples/react-landing/server ./server
COPY examples/react-landing/package.json examples/react-landing/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
EXPOSE 3001
CMD ["node", "server/serve.ts"]