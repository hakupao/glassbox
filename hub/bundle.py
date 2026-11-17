"""The single-file page: `bundle(page) -> str` (hub/page.py holds the code; this is its public name).

Used for the private view (hub/server.py) and the public snapshot (exporter): web/index.html with
every stylesheet and script inlined, the CSP meta first in <head>, and the page data injected once
as `<script>window.GB = <strict JSON>;</script>`.
"""
from .page import CSP, bundle

__all__ = ["CSP", "bundle"]
