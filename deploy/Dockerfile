# glassbox hub image. Contains only this repository's hub code: no data, no keys, no config.
# Build context is the repository root (see compose.yaml).
# Pinned tag; add the @sha256 digest of the tag when deploying (docker buildx imagetools inspect).
FROM python:3.12.8-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin glassbox \
 && mkdir /data && chown glassbox:glassbox /data

WORKDIR /app
COPY hub/ /app/hub/
# Runtime dependencies of the hub besides hub/: the price table (probe/pricing.py, pricing.json,
# imported by hub/page.py; all of probe/ is copied) and the private-view template, which
# hub/server.py reads from <repo root>/design/mockups/c-v9.html. When the template moves to
# web/, replace the design/ line with a web/ copy and the matching line in Dockerfile.dockerignore.
COPY probe/ /app/probe/
COPY design/mockups/c-v9.html /app/design/mockups/c-v9.html
COPY deploy/entrypoint.sh /usr/local/bin/glassbox-entrypoint
RUN chmod 0755 /usr/local/bin/glassbox-entrypoint

USER glassbox
VOLUME /data
ENTRYPOINT ["glassbox-entrypoint"]
