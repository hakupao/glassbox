# glassbox hub image. Contains only this repository's hub code: no data, no keys, no config.
# Build context is the repository root (see compose.yaml).
# Pinned tag; add the @sha256 digest of the tag when deploying (docker buildx imagetools inspect).
FROM python:3.12.8-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# uid AND gid 10001: the host files under /opt/glassbox are root:10001 and must be readable by this group.
RUN groupadd --system --gid 10001 glassbox \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin glassbox \
 && mkdir /data && chown glassbox:glassbox /data

WORKDIR /app
COPY hub/ /app/hub/
# Runtime dependencies of the hub besides hub/: the price table (probe/pricing.py, pricing.json,
# imported by hub/page.py; all of probe/ is copied) and the front end web/, which hub/page.py
# bundles from <repo root>/web into the single inlined page that / serves.
COPY probe/ /app/probe/
COPY web/ /app/web/
COPY scripts/verify_public.py /app/scripts/verify_public.py
COPY schema/public_fields.json /app/schema/public_fields.json
COPY deploy/entrypoint.sh /usr/local/bin/glassbox-entrypoint
RUN chmod 0755 /usr/local/bin/glassbox-entrypoint

USER 10001:10001
VOLUME /data
ENTRYPOINT ["glassbox-entrypoint"]
