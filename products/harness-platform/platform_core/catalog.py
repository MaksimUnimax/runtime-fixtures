"""Versioned declarations for tools supplied by the platform's trusted composition."""

from __future__ import annotations

import inspect
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from referencing import Registry
from referencing.jsonschema import DRAFT202012


MANIFEST_VERSION = 1
_IDENTIFIER = re.compile(r"[A-Za-z0-9_.-]{1,128}")
_VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}")
_DIALECT = Draft202012Validator.META_SCHEMA["$id"]
ToolHandler = Callable[[Any, dict[str, Any]], Any]


def _identifier(value: str) -> bool:
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def _json_object(value: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    try:
        encoded = json.dumps(value, allow_nan=False)
        decoded = json.loads(encoded)
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError("expected finite JSON data") from exc
    if decoded != value:
        raise ValueError("expected JSON object keys and arrays")
    return encoded, decoded


def _compile_schema(schema: dict[str, Any]) -> Draft202012Validator:
    if schema.get("type") != "object":
        raise ValueError("tool input schema must declare type object")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise ValueError("invalid tool input schema") from exc
    pending = [schema]
    while pending:
        node = pending.pop()
        if isinstance(node, bool):
            continue
        if node.get("$schema", _DIALECT) != _DIALECT:
            raise ValueError("tool schemas must use JSON Schema draft 2020-12")
        if any(key in node for key in ("$ref", "$dynamicRef", "$recursiveRef")):
            raise ValueError("manifest v1 supports self-contained inline schemas only")
        pending.extend(DRAFT202012.subresources_of(node))
    # A registry without a retrieval callback cannot fetch remote documents.
    return Draft202012Validator(schema, registry=Registry())


@dataclass(frozen=True, slots=True, init=False)
class Capability:
    """A trusted handler must honor its declared effect; v1 exposes reads only."""

    name: str
    description: str
    effect: str
    handler: ToolHandler = field(repr=False)
    _encoded_schema: str = field(repr=False)
    _validator: Draft202012Validator = field(repr=False, compare=False)

    def __init__(
        self, name: str, description: str, input_schema: dict[str, Any],
        handler: ToolHandler, *, effect: str = "read",
    ):
        if not _identifier(name):
            raise ValueError("invalid MCP tool name")
        if not isinstance(description, str) or not description.strip():
            raise ValueError("tool description is required")
        if effect != "read":
            raise ValueError("manifest v1 supports read capabilities only")
        call = getattr(handler, "__call__", None)
        if not callable(handler) or any(
            inspect.iscoroutinefunction(fn) or inspect.isasyncgenfunction(fn)
            for fn in (handler, call)
        ):
            raise ValueError("tool handler must be a synchronous callable")
        encoded, schema = _json_object(input_schema)
        object.__setattr__(self, "_validator", _compile_schema(schema))
        object.__setattr__(self, "_encoded_schema", encoded)
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "description", description)
        object.__setattr__(self, "effect", effect)
        object.__setattr__(self, "handler", handler)

    @property
    def input_schema(self) -> dict[str, Any]:
        """Return a copy for MCP discovery, independent of the validation contract."""
        return json.loads(self._encoded_schema)

    def validate(self, arguments: dict[str, Any]) -> None:
        _, value = _json_object(arguments)
        problem = next(self._validator.iter_errors(value), None)
        if problem is not None:
            # ValidationError.message can include private arguments. Expose only the rule.
            raise ValueError(f"arguments violate tool schema ({problem.validator})")


@dataclass(frozen=True, slots=True)
class Plugin:
    id: str
    version: str
    capabilities: tuple[Capability, ...]
    manifest_version: int = MANIFEST_VERSION

    def __post_init__(self) -> None:
        if not _identifier(self.id):
            raise ValueError("invalid plugin identifier")
        if not isinstance(self.version, str) or not _VERSION.fullmatch(self.version):
            raise ValueError("invalid plugin version")
        if type(self.manifest_version) is not int or self.manifest_version != MANIFEST_VERSION:
            raise ValueError("unsupported plugin manifest version")
        try:
            capabilities = tuple(self.capabilities)
        except TypeError as exc:
            raise ValueError("plugin capabilities must be iterable") from exc
        if not capabilities or not all(isinstance(item, Capability) for item in capabilities):
            raise ValueError("a tool plugin must declare at least one capability")
        object.__setattr__(self, "capabilities", capabilities)


class Catalog:
    """Index an explicitly supplied set of trusted plugins at process startup."""

    def __init__(self, plugins: Iterable[Plugin]):
        plugin_ids: set[str] = set()
        self._tools: dict[str, Capability] = {}
        self._owners: dict[str, Plugin] = {}
        for plugin in plugins:
            if not isinstance(plugin, Plugin):
                raise ValueError("invalid plugin declaration")
            if plugin.id in plugin_ids:
                raise ValueError(f"duplicate plugin id: {plugin.id}")
            plugin_ids.add(plugin.id)
            for tool in plugin.capabilities:
                if tool.name in self._tools:
                    raise ValueError(f"duplicate tool name: {tool.name}")
                self._tools[tool.name] = tool
                self._owners[tool.name] = plugin

    def tools(self) -> tuple[Capability, ...]:
        return tuple(self._tools.values())

    def get(self, name: str) -> Capability:
        return self._tools[name]

    def plugin_for(self, name: str) -> Plugin:
        return self._owners[name]
