FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Cloud Run injects PORT=8080 itself at runtime; this is just a sane default for a local
# `docker run`, not load-bearing for the actual deployment.
ENV PORT=8080
EXPOSE 8080
# node:20-slim ships a built-in non-root `node` user — run as that instead of root, for
# defense-in-depth (flagged in the pre-migration security review).
USER node
CMD ["npx", "tsx", "server.ts"]
