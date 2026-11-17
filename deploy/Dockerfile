# glassbox hub image. Contains only this repository's hub code: no data, no keys, no config.
# Build context is the repository root (see compose.yaml).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin glassbox \
 && mkdir /data && chown glassbox:glassbox /data

WORKDIR /app
COPY hub/ /app/hub/
COPY deploy/entrypoint.sh /usr/local/bin/glassbox-entrypoint
RUN chmod 0755 /usr/local/bin/glassbox-entrypoint

USER glassbox
VOLUME /data
ENTRYPOINT ["glassbox-entrypoint"]
