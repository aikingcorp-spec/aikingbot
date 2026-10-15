# AIKINGBOT server image. Build context: an unpacked server bundle produced by
#   node apps/desktop-foundation/server-bundle.mjs
# (see docs/aikingbot/server-deployment.md). The image holds no build tools:
# the bundle is self-contained (dist-server + dist + DuckDB natives).
#
# The server binds 127.0.0.1 inside the container; Caddy shares the network
# namespace (compose.yaml) so remote requests always arrive through a proxy
# with forwarded headers and never inherit loopback trust.
#
# Build hosts behind a TLS-inspecting proxy can pass its CA for the build only:
#   docker build --secret id=build_ca,src=/path/ca.crt ...   (not stored in the image)
FROM node:24-bookworm-slim AS runtime
ARG WITH_BROWSER=1
# git (agent CLIs) and the browser libraries. 0 only for minimal test images.
ARG WITH_SYSTEM_PACKAGES=1
ARG AGENT_BROWSER_VERSION=0.37.0
RUN --mount=type=secret,id=build_ca,required=false \
  APT="apt-get"; if [ -s /run/secrets/build_ca ]; then \
    sed -i 's#http://deb.debian.org#https://deb.debian.org#g' /etc/apt/sources.list.d/debian.sources; \
    APT="apt-get -o Acquire::https::CAInfo=/run/secrets/build_ca"; fi \
  && if [ "$WITH_SYSTEM_PACKAGES" = "1" ]; then $APT update \
  && $APT install -y --no-install-recommends ca-certificates git; fi \
  && if [ "$WITH_BROWSER" = "1" ]; then $APT install -y --no-install-recommends \
    libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 \
    libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0 \
    libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 \
    libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 \
    libfontconfig1 libdbus-1-3 libnss3 libnss3-tools libnspr4 \
    libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 \
    libxshmfence1 libgbm1 fonts-noto-color-emoji fonts-noto-cjk fonts-freefont-ttf; fi \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --home-dir /data --shell /bin/bash --uid 10001 aiking
# The agents' browser: pinned agent-browser and its Chrome for Testing, outside /data.
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    if [ "$WITH_BROWSER" = "1" ]; then \
      npm install -g --cache /tmp/npm-cache agent-browser@${AGENT_BROWSER_VERSION} \
      && HOME=/opt/aikingbot-browser agent-browser install \
      && ln -s /opt/aikingbot-browser/.agent-browser/browsers/chrome-*/chrome /opt/aikingbot-browser/chrome \
      && agent-browser --version \
      && rm -rf /tmp/npm-cache /tmp/node-compile-cache; \
    fi
ENV AGENT_BROWSER_EXECUTABLE_PATH=/opt/aikingbot-browser/chrome \
    OMB_DUCKDB_DIR=/app/duckdb \
    OMB_DATA_DIR=/data/.aikingbot \
    OMB_STATIC_DIR=/app/dist \
    OMB_PORT=8799 \
    OMB_WEBHOOK_PORT=8800 \
    OMB_LOOPBACK_TRUST=service \
    NODE_ENV=production \
    HOME=/data
WORKDIR /app
COPY --chown=root:root duckdb ./duckdb
COPY --chown=root:root dist-server ./dist-server
COPY --chown=root:root dist ./dist
COPY --chown=root:root licenses ./licenses
COPY --chown=root:root bundle-manifest.json ./bundle-manifest.json
COPY --chown=root:root package.json ./package.json
COPY --chown=root:root deploy/scripts/container-start.sh /usr/local/bin/aikingbot-start
RUN chmod 0755 /usr/local/bin/aikingbot-start && chmod -R go-w /app
LABEL org.opencontainers.image.title="AIKINGBOT server" \
      org.opencontainers.image.source="https://github.com/aikingcorp-spec/AIKINGX_Bot" \
      org.opencontainers.image.licenses="Apache-2.0 AND LicenseRef-AIKING"
VOLUME ["/data"]
USER aiking
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8799/api/health',{signal:AbortSignal.timeout(4000)}).then(async r=>process.exit(r.ok&&(await r.json()).app?0:1)).catch(()=>process.exit(1))"]
# Run with an init (compose sets init: true; docker run --init) to reap browser children.
CMD ["/usr/local/bin/aikingbot-start"]
