import unittest
from dataclasses import FrozenInstanceError

from platform_core.catalog import Capability, Catalog, Plugin


def echo(scope, arguments):
    return arguments


def tool(name="value.read", **kwargs):
    return Capability(
        name,
        "Read a value",
        {"type": "object", "properties": {"n": {"type": "integer"}}, "additionalProperties": False},
        echo,
        **kwargs,
    )


class CatalogTests(unittest.TestCase):
    def test_trusted_registration_and_empty_composition(self):
        self.assertEqual(Catalog([]).tools(), ())
        first, second = tool(), tool("label.read")
        entries = [first]
        plugin = Plugin("demo", "1.0.0", entries)
        entries.clear()
        catalog = Catalog([plugin, Plugin("other", "1.0.0", (second,))])
        self.assertEqual(catalog.tools(), (first, second))
        self.assertIs(catalog.get(first.name), first)
        self.assertIs(catalog.plugin_for(first.name), plugin)
        with self.assertRaises(KeyError):
            catalog.get("unknown")
        with self.assertRaises(FrozenInstanceError):
            first.name = "renamed"

    def test_duplicate_tool_and_plugin_ids_fail_at_startup(self):
        first = Plugin("one", "1", (tool(),))
        for duplicate in (Plugin("other", "2", (tool(),)), Plugin("one", "2", (tool("v2"),))):
            with self.subTest(plugin=duplicate.id), self.assertRaises(ValueError):
                Catalog([first, duplicate])
        with self.assertRaises(ValueError):
            Catalog([Plugin("one", "1", (tool(), tool()))])

    def test_validation_uses_an_immutable_snapshot_without_logging_arguments(self):
        schema = {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]}
        item = Capability("read", "Read n", schema, echo)
        schema["properties"]["n"]["type"] = "string"
        item.input_schema["properties"].clear()
        item.validate({"n": 0})
        with self.assertRaises(ValueError) as failure:
            item.validate({"n": "private-value"})
        self.assertNotIn("private-value", str(failure.exception))
        self.assertEqual(item.input_schema["properties"]["n"]["type"], "integer")
        for invalid in ([], {}, {"n": True}, {"n": float("nan")}, {2: "string"}, {"n": object()}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                item.validate(invalid)

    def test_schema_errors_and_references_are_rejected_eagerly(self):
        schemas = (
            {"type": "string"}, {"type": "object", "required": 1},
            {"type": "object", "$defs": {"a": {"$ref": "https://example.invalid/s"}}},
            {"type": "object", "allOf": [{"properties": {"a": {"$dynamicRef": "#root"}}}]},
            {"type": "object", "additionalProperties": {"$schema": "http://json-schema.org/draft-07/schema#"}},
        )
        for schema in schemas:
            with self.subTest(schema=schema), self.assertRaises(ValueError):
                Capability("r", "Read", schema, echo)
        # A property named "$ref" is application data, not a JSON Schema reference.
        permitted = {"type": "object", "properties": {"$ref": {"type": "string"}}}
        Capability("r", "Read", permitted, echo).validate({"$ref": "literal-data"})

    def test_invalid_manifest_metadata_handler_and_effect_fail_eagerly(self):
        async def async_handler(scope, args):
            return args

        for name in ("", "space not allowed", "x" * 129):
            with self.subTest(name=name), self.assertRaises(ValueError):
                tool(name)
        for handler in (None, async_handler):
            with self.subTest(handler=handler), self.assertRaises(ValueError):
                Capability("r", "Read", {"type": "object"}, handler)
        with self.assertRaises(ValueError):
            Plugin("id", "v1", (tool(),), manifest_version=2)
        with self.assertRaises(ValueError):
            Plugin("id", "", (tool(),))
        with self.assertRaises(ValueError):
            tool(effect="write")
        self.assertEqual(tool().effect, "read")


if __name__ == "__main__":
    unittest.main()
