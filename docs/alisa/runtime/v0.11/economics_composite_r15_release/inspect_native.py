"""Read-only import probe, executed with the pinned real Python, -I and -B.

It does not instantiate RuntimePort/Worker or open a database/configuration.
The audit hook is a fail-closed guard for these reviewed Python imports; it is
not an operating-system sandbox for arbitrary untrusted extensions.
"""
import json
import os
from pathlib import Path
import sys


def deny_effects(event, args):
    if event == 'open':
        mode, flags = args[1], args[2]
        if (isinstance(mode, str) and any(x in mode for x in 'wax+')) or (
                isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)):
            raise RuntimeError('PROBE_WRITE_DENIED')
    if (event.startswith(('socket.', 'subprocess.', 'sqlite3.'))
            or event in {'os.system', 'os.exec', 'os.posix_spawn', 'os.fork',
                         'os.mkdir', 'os.remove', 'os.rmdir', 'os.rename',
                         'os.link', 'os.symlink', 'os.chmod', 'os.truncate'}):
        raise RuntimeError('PROBE_EFFECT_DENIED')


def inspect(root):
    root = Path(root).resolve(strict=True)
    sys.dont_write_bytecode = True
    sys.addaudithook(deny_effects)
    sys.path.insert(0, str(root))  # -I deliberately ignores PYTHONPATH.
    import runtime_port
    import read_surface
    import parameter_source_runtime
    import template_catalog
    template_catalog.validate_catalog()
    result = {'versions': runtime_port.current_versions(),
              'read_surface_pin': read_surface.PIN,
              'parameter_sources_pin': parameter_source_runtime.PIN,
              'parameter_compounds_pin': None, 'economics_composites_pin': None}
    if (root / 'parameter_report_runtime.py').exists():
        import parameter_report_runtime
        result['parameter_compounds_pin'] = parameter_report_runtime.PIN
    if (root / 'economics_report_runtime.py').exists():
        import economics_report_runtime
        result['economics_composites_pin'] = economics_report_runtime.PIN
    return result


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1]), sort_keys=True))
