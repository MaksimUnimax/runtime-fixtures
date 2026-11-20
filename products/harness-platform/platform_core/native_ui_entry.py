"""Load the pinned Web entry with executable Cordis YAML config disabled."""

import hashlib
from pathlib import Path

_RELEASE_SHA256 = "c7e9821660f7e0f0524cc7cb1a375a5171eebbe68e167b80d290bd2ea391286d"
_DYNAMIC_CONFIG = b'''const n7=new Function("ctx","expr",`
  with (ctx) {
    return eval(expr)
  }
`);'''
_LITERAL_ONLY = b'const n7=()=>{throw Error("Executable YAML configuration is disabled")};'


def browser_entry(path: Path) -> bytes:
    """The product boot graph only contains literals; keep script-src 'self'."""
    source = path.read_bytes()
    if hashlib.sha256(source).hexdigest() != _RELEASE_SHA256 or source.count(_DYNAMIC_CONFIG) != 1:
        raise ValueError("Unsupported Harness web entry revision")
    return source.replace(_DYNAMIC_CONFIG, _LITERAL_ONLY, 1)
