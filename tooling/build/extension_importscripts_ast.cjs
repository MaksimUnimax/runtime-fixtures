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
  const globalAliases = new Set();
  const ordinaryProof = new Map();
  // Only a plain top-level importScripts(...) is supported for flattening.
  // Other executable references must fail closed rather than reach Firefox
  // as worker-only calls in an event-page background script.
  function isInertIdentifier(node) {
    const parent = node.parent;
    // JavaScript labels (including escaped spellings) are control-flow
    // markers, not executable references to the importScripts API.
    if (
      (ts.isLabeledStatement(parent) ||
       ts.isBreakStatement(parent) ||
       ts.isContinueStatement(parent)) &&
      parent.label === node
    ) {
      return true;
    }
    // A property name is not an API reference when its receiver is a proven
    // local object. Global/unknown receivers are checked by visit below.
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      return ordinaryObject(parent.expression);
    }
    if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
    return (
      (ts.isPropertyAssignment(parent) ||
       ts.isMethodDeclaration(parent) ||
       ts.isPropertyDeclaration(parent) ||
       ts.isGetAccessorDeclaration(parent) ||
       ts.isSetAccessorDeclaration(parent)) &&
      parent.name === node
    );
  }
  // Resolve only lexically bound const initializers, using the pinned parser's
  // binder instead of a name-only map that could confuse shadowed variables.
  // The host is entirely in-memory: no library, module, or application I/O.
  let checker;
  function symbolAt(node) {
    if (!checker) {
      const isInput = name => name === file.fileName || name === "/" + file.fileName;
      const host = {
        getSourceFile: name => isInput(name) ? file : undefined,
        getDefaultLibFileName: () => "",
        writeFile: () => { throw new Error("IMPORT_SCRIPTS_UNEXPECTED_EMIT"); },
        getCurrentDirectory: () => "/",
        getDirectories: () => [],
        fileExists: isInput,
        readFile: name => isInput(name) ? source : undefined,
        getCanonicalFileName: name => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
      };
      const program = ts.createProgram([file.fileName], {
        allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [],
        target: ts.ScriptTarget.Latest,
      }, host);
      checker = program.getTypeChecker();
    }
    return checker.getSymbolAtLocation(node);
  }
  function constantInitializer(node) {
    const declarations = symbolAt(node)?.declarations;
    if (declarations?.length !== 1) return undefined;
    const declaration = declarations[0];
    if (
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    ) return undefined;
    return declaration.initializer;
  }
  // Fold strings and immutable lexical aliases without running source code.
  // Mutable, destructured string keys, parameter and runtime values stay unknown.
  function staticPropertyName(node, depth = 0) {
    if (depth > 64) {
      throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isParenthesizedExpression(node)) {
      return staticPropertyName(node.expression, depth + 1);
    }
    if (ts.isIdentifier(node)) {
      const initializer = constantInitializer(node);
      return initializer ? staticPropertyName(initializer, depth + 1) : undefined;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticPropertyName(node.left, depth + 1);
      const right = staticPropertyName(node.right, depth + 1);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const value = staticPropertyName(span.expression, depth + 1);
        if (value === undefined) return undefined;
        text += value + span.literal.text;
      }
      return text;
    }
    return undefined;
  }
  function bindingPropertyName(binding) {
    const name = binding.propertyName || binding.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return ts.isComputedPropertyName(name) ? staticPropertyName(name.expression) : undefined;
  }
  function bindingSourceIsGlobal(binding, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    if (!ts.isObjectBindingPattern(binding.parent)) return false;
    const owner = binding.parent.parent;
    if (ts.isVariableDeclaration(owner)) {
      return !!owner.initializer && workerGlobal(owner.initializer, depth + 1);
    }
    return ts.isBindingElement(owner) &&
      ["self", "globalThis"].includes(bindingPropertyName(owner)) &&
      bindingSourceIsGlobal(owner, depth + 1);
  }
  function unwrap(node) {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
  }
  function aliasKey(node) {
    return symbolAt(node) || "unbound:" + node.text;
  }
  function literalObject(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (ts.isObjectLiteralExpression(node)) return node;
    if (!ts.isIdentifier(node) || globalAliases.has(aliasKey(node))) return undefined;
    const initializer = constantInitializer(node);
    return initializer ? literalObject(initializer, depth + 1) : undefined;
  }
  function propertyName(node) {
    const name = node.name;
    if (!name) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return ts.isComputedPropertyName(name) ? staticPropertyName(name.expression) : undefined;
  }
  function ownMethodExtraction(pattern) {
    pattern = unwrap(pattern);
    const properties = ts.isObjectBindingPattern(pattern) ? pattern.elements :
      ts.isObjectLiteralExpression(pattern) ? pattern.properties : undefined;
    return !!properties?.length && properties.every(property => {
      if (ts.isBindingElement(property)) {
        return !property.dotDotDotToken && !property.initializer &&
          bindingPropertyName(property) === "importScripts" && ts.isIdentifier(property.name);
      }
      return ts.isPropertyAssignment(property) && propertyName(property) === "importScripts" &&
        ts.isIdentifier(property.initializer);
    });
  }
  function isMutation(node) {
    let target = node;
    while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
    const parent = target.parent;
    return ts.isDeleteExpression(parent) ||
      ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
       [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)) ||
      (ts.isBinaryExpression(parent) && parent.left === target &&
       parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
       parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment);
  }
  function ordinaryObject(node) {
    const root = literalObject(node);
    if (!root) return false;
    if (ordinaryProof.has(root)) return ordinaryProof.get(root);
    // Only a known own function can shadow the worker API. Inherited methods,
    // unknown computed members, spreads and prototype overrides are not proof.
    const members = root.properties.filter(property => propertyName(property) === "importScripts");
    let safe = members.length === 1 && root.properties.every(property =>
      !ts.isSpreadAssignment(property) && propertyName(property) !== undefined &&
      propertyName(property) !== "__proto__",
    );
    const method = members[0];
    safe = safe && (ts.isMethodDeclaration(method) ||
      (ts.isPropertyAssignment(method) &&
       (ts.isFunctionExpression(unwrap(method.initializer)) || ts.isArrowFunction(unwrap(method.initializer)))));
    // An opaque call/return/storage of the receiver can mutate or delete its
    // own member. Follow const aliases and reject such escapes, not just the
    // literal at declaration time. Unrelated named field updates stay valid.
    function inspect(current) {
      if (!safe) return;
      if (ts.isIdentifier(current) && literalObject(current) === root) {
        let use = current;
        while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
        const parent = use.parent;
        if (ts.isVariableDeclaration(parent) && parent.name === current) {
          // The declaration name is not a use.
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === use &&
          ((ts.isIdentifier(parent.name) && constantInitializer(parent.name) === use) ||
           ownMethodExtraction(parent.name))) {
          // A const lexical alias or read-only extraction is checked elsewhere.
        } else if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === use) {
          const name = ts.isPropertyAccessExpression(parent) ? parent.name.text :
            staticPropertyName(parent.argumentExpression);
          if (isMutation(parent) && [undefined, "importScripts", "__proto__"].includes(name)) safe = false;
        } else if (ts.isBinaryExpression(parent) && parent.right === use &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ownMethodExtraction(parent.left)) {
          // Destructuring assignment reads the known own method without escape.
        } else {
          safe = false;
        }
      }
      if (current.kind === ts.SyntaxKind.ThisKeyword) {
        // A method that exports or rewrites its receiver cannot establish an
        // immutable ordinary API even if its initializer contains that member.
        const parent = current.parent;
        if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === current) {
          const name = ts.isPropertyAccessExpression(parent) ? parent.name.text :
            staticPropertyName(parent.argumentExpression);
          if ([undefined, "importScripts", "__proto__"].includes(name)) safe = false;
        } else {
          safe = false;
        }
      }
      ts.forEachChild(current, inspect);
    }
    if (safe) {
      // Receiver uses across the complete source; method-local this separately.
      function uses(current) {
        if (!safe) return;
        if (ts.isIdentifier(current)) inspect(current);
        else ts.forEachChild(current, uses);
      }
      uses(file);
      if (safe) inspect(method);
    }
    ordinaryProof.set(root, safe);
    return safe;
  }
  function markGlobalTarget(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      globalAliases.add(aliasKey(node));
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      markGlobalTarget(node.left, depth + 1);
      return;
    }
    const elements = ts.isObjectBindingPattern(node) ? node.elements :
      ts.isObjectLiteralExpression(node) ? node.properties : undefined;
    if (!elements) return;
    for (const element of elements) {
      const binding = ts.isBindingElement(element);
      const name = binding ? bindingPropertyName(element) : propertyName(element);
      if (element.dotDotDotToken || ts.isSpreadAssignment(element) || name === undefined) {
        throw new Error("IMPORT_SCRIPTS_UNRESOLVED_GLOBAL_REFERENCE");
      }
      if (name === "importScripts") throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
      if (["self", "globalThis"].includes(name)) {
        const target = binding ? element.name : ts.isShorthandPropertyAssignment(element) ?
          element.name : element.initializer;
        if (target) markGlobalTarget(target, depth + 1);
      }
    }
  }
  function collectGlobalAliases() {
    const writes = [];
    function collect(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) writes.push([node.name, node.initializer]);
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]
        .includes(node.operatorToken.kind)) writes.push([node.left, node.right]);
      ts.forEachChild(node, collect);
    }
    collect(file);
    // Monotone may-alias analysis: a later benign assignment never erases the
    // possibility of an earlier global reference. Symbols keep shadows apart.
    for (let pass = 0; pass <= 64; pass++) {
      const size = globalAliases.size;
      for (const [target, value] of writes) if (workerGlobal(value)) markGlobalTarget(target);
      if (size === globalAliases.size) return;
    }
    throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
  }
  function workerGlobal(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    if (ts.isParenthesizedExpression(node)) return workerGlobal(node.expression, depth + 1);
    if (ts.isIdentifier(node)) {
      if (globalAliases.has(aliasKey(node))) return true;
      if (["self", "globalThis"].includes(node.text) && !symbolAt(node)?.declarations?.length) {
        return true;
      }
      const declarations = symbolAt(node)?.declarations;
      if (declarations?.length === 1 && ts.isBindingElement(declarations[0])) {
        const binding = declarations[0];
        return ["self", "globalThis"].includes(bindingPropertyName(binding)) &&
          bindingSourceIsGlobal(binding, depth + 1);
      }
      const initializer = constantInitializer(node);
      return initializer ? workerGlobal(initializer, depth + 1) : false;
    }
    if (ts.isConditionalExpression(node)) {
      return workerGlobal(node.whenTrue, depth + 1) || workerGlobal(node.whenFalse, depth + 1);
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.CommaToken,
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken]
      .includes(node.operatorToken.kind)) {
      return workerGlobal(node.right, depth + 1) ||
        (![ts.SyntaxKind.EqualsToken, ts.SyntaxKind.CommaToken].includes(node.operatorToken.kind) &&
         workerGlobal(node.left, depth + 1));
    }
    const name = ts.isPropertyAccessExpression(node) ? node.name.text :
      ts.isElementAccessExpression(node) ? staticPropertyName(node.argumentExpression) : undefined;
    return ["self", "globalThis"].includes(name) && workerGlobal(node.expression, depth + 1);
  }
  function isPureWrite(node) {
    let target = node;
    while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
    const parent = target.parent;
    return ts.isBinaryExpression(parent) && parent.left === target &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  }
  function visit(node) {
    if (ts.isBindingElement(node) && bindingPropertyName(node) === "importScripts") {
      const declaration = node.parent.parent;
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer ||
        !ordinaryObject(declaration.initializer)) throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ownMethodExtraction(node.left) && !ordinaryObject(node.right)) {
      throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
    }
    if (ts.isBindingElement(node) && bindingSourceIsGlobal(node)) {
      const name = bindingPropertyName(node);
      if (node.dotDotDotToken || name === undefined) {
        throw new Error("IMPORT_SCRIPTS_UNRESOLVED_GLOBAL_REFERENCE");
      }
      if (name === "importScripts") throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
    }
    const computedName = ts.isElementAccessExpression(node) ?
      staticPropertyName(node.argumentExpression) : undefined;
    if (
      ts.isElementAccessExpression(node) && computedName === undefined &&
      workerGlobal(node.expression) && !isPureWrite(node)
    ) {
      // An unknown worker-global value can be called now or aliased later.
      // Do not silently carry a possible importScripts into an event page.
      // Pure writes and dynamic accesses on ordinary objects are unaffected.
      throw new Error("IMPORT_SCRIPTS_UNRESOLVED_GLOBAL_REFERENCE");
    }
    if (
      ((ts.isPropertyAccessExpression(node) && node.name.text === "importScripts") ||
       (ts.isElementAccessExpression(node) && computedName === "importScripts")) &&
      !ordinaryObject(node.expression)
    ) {
      // Includes self.importScripts, globalThis["importScripts"], aliases
      // and .call() usages. Property keys in object definitions are inert.
      throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "importScripts" &&
      !isInertIdentifier(node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      // Reject (importScripts)(...), const alias=importScripts and other
      // references that are not handled by the top-level static flattener.
      throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
    }
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
      if (!node.arguments.every(arg => ts.isStringLiteral(arg))) {
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
  collectGlobalAliases();
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
