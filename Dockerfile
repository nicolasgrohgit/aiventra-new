FROM node:20-slim
# node:20-slim strips out ca-certificates, which every outbound TLS connection needs to
# verify the peer's certificate chain — without it, a TLS handshake fails partway through
# (connects fine at the TCP level, dies during the handshake) rather than refusing to connect
# at all, which is exactly what broke the MongoDB Atlas connection (Atlas requires TLS) when
# first deployed here: the driver's error just said "could not connect to any servers," not
# anything pointing at a missing CA bundle.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
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
