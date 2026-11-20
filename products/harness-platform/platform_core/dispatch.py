"""One trusted chat binding per dispatcher. The caller supplies only a tool and arguments."""

import json

from .catalog import Catalog
from .storage import Scope, Store


class UnavailableTool(PermissionError):
    """The current principal has no usable capability under this name."""


class InvalidToolInput(ValueError):
    """Validation failed before the plugin handler was entered."""


class ToolExecutionFailed(RuntimeError):
    """Public error which does not expose provider messages or arguments."""


class Dispatcher:
    def __init__(self, catalog: Catalog, store: Store, scope: Scope):
        self.catalog = catalog
        self.store = store
        self.scope = scope

    def connection_tools(self):
        from .chat_connections import ChatTools
        return ChatTools(self.store,self.scope).tools()

    def list_tools(self):
        allowed = frozenset(self.store.enabled_plugins(self.scope))
        return self.connection_tools() + tuple(
            tool for tool in self.catalog.tools()
            if self.catalog.plugin_for(tool.name).id in allowed
        )

    def call_tool(self, name, arguments):
        try:
            plugin = self.catalog.plugin_for(name)
        except KeyError:
            tool = next((t for t in self.connection_tools() if t.name==name),None)
            if tool is None:
                raise UnavailableTool("Tool unavailable in this chat") from None
            plugin = None
        if plugin is not None and not self.store.permits(self.scope, plugin.id):
            raise UnavailableTool("Tool unavailable in this chat")
        if plugin is not None:
            tool = self.catalog.get(name)
        try:
            tool.validate(arguments)
        except ValueError as error:
            raise InvalidToolInput("Arguments do not match the tool schema") from error
        try:
            result = tool.handler(self.scope, arguments)
            # Reject lossy encodings, e.g. numeric and string keys with the same spelling.
            canonical = json.loads(json.dumps(result, allow_nan=False))
            if canonical != result:
                raise ValueError("Result is not a JSON value")
            return canonical
        except Exception:
            raise ToolExecutionFailed("Tool execution failed") from None
