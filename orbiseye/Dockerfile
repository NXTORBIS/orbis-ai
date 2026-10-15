# OrbisEye — container image.
#
# Serves the BUILT bundle via `vite preview`, not the dev server. Both carry the
# /api/* proxies (vite.config.js now registers every proxy for preview as well
# as dev), but preview skips the module graph, HMR and dep-optimizer, so it
# starts faster and fits a 512MB free tier that the dev server can overrun.
#
# This is still a Node process, not static hosting. OrbisEye's backend is Vite
# plugin middleware — 24 /api/* routes for flights, satellites, terrain, CCTV,
# radio and the rest. A static host (Netlify / Vercel / Pages) serves the shell
# and 404s every one of them, which surfaces in the UI as
# "UNAVAILABLE · HTTP 404" on each layer.
#
# Runs as uid 1000 because Hugging Face Spaces requires a non-root user; that is
# harmless on Render / Fly / plain Docker.

FROM node:24-slim

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user
WORKDIR /home/user/app

# Lockfile-only layer so dependency installs cache across code changes.
COPY --chown=user:user package.json package-lock.json ./
RUN npm ci

COPY --chown=user:user . .

# Build at image-build time so the running container only has to serve.
RUN npm run build

# Bind to all interfaces so the platform's router can reach the process.
ENV HOST=0.0.0.0
# OpenSky works fully anonymously; without this the proxy attempts an OAuth
# handshake it has no credentials for.
ENV OPENSKY_AUTH_MODE=anon

# Render and most platforms inject $PORT; 7860 is the Hugging Face default.
EXPOSE 7860

CMD ["sh", "-c", "node node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port ${PORT:-7860}"]
