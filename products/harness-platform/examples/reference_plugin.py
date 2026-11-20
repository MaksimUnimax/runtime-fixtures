"""Optional read-only sample. Selected explicitly by the local operator in the quickstart."""

from platform_core.catalog import Capability, Plugin


def summarize_text(_scope, arguments):
    words = arguments["text"].split()
    return {"words": len(words), "normalized": " ".join(words)}


PLUGINS = (
    Plugin(
        id="reference-text",
        version="1.0.0",
        capabilities=(
            Capability(
                name="summarize_text",
                description="Count words and normalize whitespace in the supplied text.",
                input_schema={
                    "type": "object",
                    "properties": {"text": {"type": "string", "maxLength": 4096}},
                    "required": ["text"],
                    "additionalProperties": False,
                },
                handler=summarize_text,
            ),
        ),
    ),
)
