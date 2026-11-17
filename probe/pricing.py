"""API-equivalent cost per request, from probe/pricing.json. Unknown prices give None."""
import json
from pathlib import Path

_DATA = json.loads((Path(__file__).with_name("pricing.json")).read_text(encoding="utf-8"))
VERSION = _DATA["version"]
MODELS = _DATA["models"]

_FIELDS = (("input", "input"), ("output", "output"), ("cache_read", "cacheRead"),
           ("cache_write5m", "cacheWrite5m"), ("cache_write1h", "cacheWrite1h"))


def cost(model, t):
    """t has keys input, output, cache_read, cache_write5m, cache_write1h. Returns USD or None."""
    p = MODELS.get(model)
    if p is None:
        return None
    lc = p.get("longContext")
    if lc and t["input"] + t["cache_read"] + t["cache_write5m"] + t["cache_write1h"] > lc["over"]:
        p = lc
    total = 0.0
    for k, pk in _FIELDS:
        n = t.get(k) or 0
        if not n:
            continue
        if pk not in p:
            return None          # a token kind with no published price: do not guess
        total += n * p[pk] / 1e6
    return total
