# syntax=docker/dockerfile:1
# The AIKINGBOT Docker image: the Linux release, run as a self-hosted server (docs/docker.md). The
# release workflow builds it on a runner of each architecture, from the AppImage of that release,
# after it checks the AppImage against the release checksums:
#
#   docker build --file docker/Dockerfile <folder that has AIKINGBOT.AppImage>
#
# The server scripts and the package list come from the unpacked release, so they always match the
# build that they run.
ARG BASE=ubuntu:24.04@sha256:a853f94d226358a79c740cfc7bce0c289748f3fe3488d921d038ccd752c61b60

FROM ${BASE} AS release
# The AppImage runtime loads libz.so to unpack itself. Unpacked, the release needs no FUSE.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*
COPY AIKINGBOT.AppImage /tmp/AIKINGBOT.AppImage
WORKDIR /tmp
RUN chmod 0700 AIKINGBOT.AppImage \
  && ./AIKINGBOT.AppImage --appimage-extract >/dev/null \
  && chmod -R u+rwX,go=rX squashfs-root \
  && test -x squashfs-root/resources/hosting/aikingbot-container

FROM ${BASE}
ARG DEBIAN_FRONTEND=noninteractive
COPY --from=release /tmp/squashfs-root/resources/hosting/packages.txt /tmp/packages.txt
# The packages of a self-hosted server, without AppArmor, which only the host can load. tini is PID 1:
# it reaps the processes that agents leave, and gives the stop signal to AIKINGBOT, which stops them.
# Agents run their commands in this image, so it also has the tools that they use most.
RUN apt-get update \
  && sed -e '/^#/d' -e '/^$/d' -e '/^apparmor$/d' /tmp/packages.txt \
    | xargs apt-get install --yes --no-install-recommends \
      git less openssh-client procps ripgrep tini unzip xz-utils \
  && rm -rf /var/lib/apt/lists/* /tmp/packages.txt
# Not root. The image of Ubuntu has the user ubuntu with the UID 1000, which AIKINGBOT takes. The home
# folder is the data volume.
RUN userdel --remove ubuntu \
  && useradd --uid 1000 --user-group --home-dir /data --create-home --shell /bin/bash aikingbot \
  && install -d -o aikingbot -g aikingbot -m 0700 /run/aikingbot
# Root owns the release, so the user and its agents cannot change it. chrome-sandbox has no SUID bit:
# the sandbox uses user namespaces, which the seccomp profile in docker/ permits.
COPY --from=release /tmp/squashfs-root /opt/AIKINGBOT/app
RUN install -d -m 0755 /opt/AIKINGBOT/hosted \
  && printf 'container\n' >/opt/AIKINGBOT/hosted/mode \
  && ln -s /opt/AIKINGBOT/app/resources/hosting/aikingbot /usr/local/bin/aikingbot

ARG VERSION=unknown
ARG REVISION=unknown
# GitHub links the package to the repository through `source`.
LABEL org.opencontainers.image.title=AIKINGBOT \
  org.opencontainers.image.source=https://github.com/aikingcorp-spec/aikingx_bot \
  org.opencontainers.image.licenses=PolyForm-Noncommercial-1.0.0 \
  org.opencontainers.image.version=${VERSION} \
  org.opencontainers.image.revision=${REVISION}
ENV LANG=C.UTF-8 XDG_RUNTIME_DIR=/run/aikingbot
USER aikingbot
WORKDIR /data
VOLUME /data
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/AIKINGBOT/app/resources/hosting/aikingbot-container"]
