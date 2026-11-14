"""Attach the catalog to a verified current core without changing frozen inputs."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('catalog_overlay_base', ROOT.parent / 'platform_stores/build_overlay.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def sources(root):
    extension = ROOT.parents[3] / 'docs/alisa/runtime/v0.11/question_catalog_r1/question_catalog_extension.py'
    service = base.replace_once((root / 'runtime_port_service.py').read_text(),
        '    try:\n        gateway = Gateway(',
        '    from question_catalog_extension import install\n    install()\n'
        '    try:\n        gateway = Gateway(')
    result = {'question_catalog_extension.py': extension.read_text(), 'runtime_port_service.py': service}
    for name, text in result.items():
        compile(text, name, 'exec')
    return result


def build(source, destination):
    return base.build(source, destination, transform=sources,
                      marker=('question_catalog_overlay', 'question-catalog-v1'))
