// Locate only real, top-level classic importScripts statements.
// The project already depends on TypeScript for parsing JavaScript grammar.
// No execution, eval, URL fetches, or provider access: source arrives on stdin.
"use strict";

const fs = require("node:fs");
const ts = require("typescript");

function locate(source) {
  const file = ts.createSourceFile(
    "service_worker.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  if (file.parseDiagnostics.length) {
    const first = file.parseDiagnostics[0];
    throw new Error(
      "INVALID_JS_SYNTAX_AT_" + first.start + ": " +
      ts.flattenDiagnosticMessageText(first.messageText, " "),
    );
  }
  const imports = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "importScripts"
    ) {
      if (
        node.questionDotToken ||
        !ts.isExpressionStatement(node.parent) ||
        node.parent.expression !== node ||
        !ts.isSourceFile(node.parent.parent)
      ) {
        // Inlining a script's statements into a conditional or expression
        // can change behavior. Never silently retain the runnable call.
        throw new Error("IMPORT_SCRIPTS_NOT_TOP_LEVEL_STATEMENT");
      }
      if (
        node.arguments.length === 0 ||
        !node.arguments.every(arg => ts.isStringLiteral(arg))
      ) {
        throw new Error("IMPORT_SCRIPTS_NON_STATIC_ARGUMENT");
      }
      imports.push({
        start: node.parent.getStart(file),
        end: node.parent.getEnd(),
        paths: node.arguments.map(arg => arg.text),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  imports.sort((a, b) => a.start - b.start);
  let lastEnd = 0;
  for (const item of imports) {
    if (item.start < lastEnd || item.end <= item.start || item.end > source.length) {
      throw new Error("IMPORT_SCRIPTS_INVALID_SOURCE_SPAN");
    }
    lastEnd = item.end;
  }
  // TypeScript records UTF-16 code-unit offsets. Python string slices use
  // Unicode code-point offsets; astral characters before an import differ.
  // Validate the AST spans in TypeScript's units before converting both ends.
  const toCodePointOffset = offset => Array.from(source.slice(0, offset)).length;
  return imports.map(item => ({
    start: toCodePointOffset(item.start),
    end: toCodePointOffset(item.end),
    paths: item.paths,
  }));
}

try {
  const source = fs.readFileSync(0, "utf8");
  const imports = locate(source);
  process.stdout.write(JSON.stringify(imports) + "\n");
} catch (error) {
  process.stderr.write(String(error.message || "JS_AST_PARSE_FAILED").slice(0, 320) + "\n");
  process.exitCode = 1;
}
