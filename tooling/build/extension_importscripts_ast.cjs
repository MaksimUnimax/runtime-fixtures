// Locate only real, top-level classic importScripts statements.
// The project already depends on TypeScript for parsing JavaScript grammar.
// No execution, eval, URL fetches, or provider access: source arrives on stdin.
"use strict";

const fs = require("node:fs");
const ts = require("typescript");

function locate(source, mode = "validate") {
  if (!["validate", "imports-only", "scan-root"].includes(mode)) throw new Error("IMPORT_SCRIPTS_INVALID_SCAN_MODE");
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
  const receiverProof = new Map();
  const nativeMemberProof = new Map();
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
  // A source file and its in-memory program never change during locate().
  // Cache each exact TypeScript lookup, including unresolved nodes, only for
  // this AST. Symbols retain their original identity and declaration objects.
  const symbolProof = new Map();
  function symbolAt(node) {
    if (symbolProof.has(node)) return symbolProof.get(node);
    const symbol = resolveSymbolAt(node);
    symbolProof.set(node, symbol);
    return symbol;
  }
  function resolveSymbolAt(node) {
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
    // A shorthand property's symbol names the new property; its value still
    // refers to the lexical binding and must not lose an intrinsic alias.
    if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) &&
      node.parent.name === node) {
      return checker.getShorthandAssignmentValueSymbol(node.parent);
    }
    return checker.getSymbolAtLocation(node);
  }
  const declarationCache = new Map();
  function bindingDeclarations(node) {
    const symbol = symbolAt(node);
    if (!symbol) return undefined;
    if (declarationCache.has(symbol)) return declarationCache.get(symbol);
    // The JS binder also records expando writes and Object.defineProperty calls
    // as declarations. Only a real lexical binding can shadow a native origin.
    const declarations = symbol.declarations?.filter(declaration =>
      ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration) ||
      ts.isParameter(declaration) || ts.isFunctionDeclaration(declaration) ||
      ts.isFunctionExpression(declaration) || ts.isClassDeclaration(declaration) ||
      ts.isClassExpression(declaration) || ts.isImportClause(declaration) ||
      ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) ||
      ts.isImportEqualsDeclaration(declaration),
    );
    declarationCache.set(symbol, declarations);
    return declarations;
  }
  function constantInitializer(node) {
    const declarations = bindingDeclarations(node);
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
        } else if (ts.isCallExpression(parent) && (() => {
          const read = reflectiveInvocation(parent);
          return read && !read.binding && read.args[0] === use && read.args.length >= 2 &&
            staticPropertyName(read.args[1]) === "importScripts";
        })()) {
          // These pinned intrinsic reads cannot mutate the proven own method.
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

  // Unknown ordinary-function receivers may be rebound to the worker global,
  // including strict functions via call/apply/bind. Only a confined object
  // method, never extracted or rebound, establishes a local receiver.
  function confinedReceiver(root) {
    if (receiverProof.has(root)) return receiverProof.get(root);
    // Break recursive proofs conservatively, never provisionally grant safety.
    receiverProof.set(root, false);
    const declaration = root.parent;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) ||
      constantInitializer(declaration.name) !== root) return false;
    const methods = new Set();
    const calls = new Map();
    const reads = [];
    const unsafeWrites = new Set();
    const keyProof = new Map();
    let safe = root.properties.every(member => {
      const name = propertyName(member);
      if (name === undefined || name === "__proto__" || ts.isSpreadAssignment(member) ||
        ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) return false;
      // An unknown initializer may also be callable. Protect its identity and
      // never allow it to be returned by a supposedly confined dynamic read.
      if (ts.isMethodDeclaration(member) || ts.isShorthandPropertyAssignment(member) ||
        (ts.isPropertyAssignment(member) &&
         ![ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral,
           ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword]
          .includes(unwrap(member.initializer).kind))) methods.add(name);
      return true;
    });
    function memberOf(fn) {
      return ts.isMethodDeclaration(fn) ? fn :
        (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
        ts.isPropertyAssignment(fn.parent) ? fn.parent : undefined;
    }
    function keys(node, seen = new Set()) {
      const name = staticPropertyName(node);
      if (name !== undefined) return [name];
      node = unwrap(node);
      const declaration = ts.isIdentifier(node) ? symbolAt(node)?.declarations?.[0] : undefined;
      if (!declaration || !ts.isParameter(declaration) || !ts.isIdentifier(declaration.name) ||
        declaration.dotDotDotToken || declaration.initializer || seen.has(declaration)) return undefined;
      if (keyProof.has(declaration)) return keyProof.get(declaration);
      if (seen.size >= 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
      keyProof.set(declaration, undefined);
      const fn = declaration.parent;
      const member = memberOf(fn);
      if (!member || member.parent !== root) return undefined;
      const incoming = calls.get(propertyName(member)) || [];
      // An empty call set establishes no parameter value or receiver proof.
      if (!incoming.length) return undefined;
      const next = new Set(seen).add(declaration);
      const result = [];
      for (const call of incoming) {
        const arg = call.arguments[fn.parameters.indexOf(declaration)];
        if (!arg || ts.isSpreadElement(arg)) return undefined;
        const values = keys(arg, next);
        if (!values) return undefined;
        result.push(...values);
      }
      const distinct = [...new Set(result)];
      keyProof.set(declaration, distinct);
      return distinct;
    }
    function confinedKey(node) {
      const names = keys(node);
      return !!names?.length && names.every(name => !methods.has(name) && !unsafeWrites.has(name) &&
        !["__proto__", "constructor", "importScripts"].includes(name));
    }
    function receiverUse(current, localThis = current.kind === ts.SyntaxKind.ThisKeyword) {
      let use = current;
      while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
      const parent = use.parent;
      if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === use) {
        const name = ts.isPropertyAccessExpression(parent) ? parent.name.text :
          staticPropertyName(parent.argumentExpression);
        if (name === "__proto__" || (isMutation(parent) &&
          (name === undefined || methods.has(name)))) return false;
        if (isMutation(parent)) {
          let target = parent;
          while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
          const write = target.parent;
          // Primitive writes cannot introduce a callable. An unknown write or
          // deletion invalidates reads of this slot, including earlier reads.
          const value = ts.isBinaryExpression(write) &&
            write.operatorToken.kind === ts.SyntaxKind.EqualsToken ? unwrap(write.right) : undefined;
          const primitive = value && (
            [ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.TrueKeyword,
             ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind) ||
            staticPropertyName(value) !== undefined);
          const numericUpdate = (ts.isPrefixUnaryExpression(write) || ts.isPostfixUnaryExpression(write)) &&
            [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(write.operator);
          if (!primitive && !numericUpdate) unsafeWrites.add(name);
        }
        let memberUse = parent;
        while (ts.isParenthesizedExpression(memberUse.parent)) memberUse = memberUse.parent;
        const directCall = ts.isCallExpression(memberUse.parent) &&
          memberUse.parent.expression === memberUse;
        if (methods.has(name) && !directCall) return false;
        if (directCall && nativeIdentityReceiver(memberUse.parent) === use)
          return receiverUse(memberUse.parent, localThis);
        if (directCall && (name === undefined || methods.has(name))) {
          // Include internal this.method(...) calls. For a dynamic dispatch,
          // every own callable slot is a possible callee until proved otherwise.
          for (const target of name === undefined ? methods : [name]) {
            const list = calls.get(target) || [];
            list.push(memberUse.parent);
            calls.set(target, list);
          }
        }
        if (name === undefined && !directCall && !isPureWrite(parent)) {
          if (!localThis) return false;
          reads.push(parent.argumentExpression);
        }
        return true;
      }
      if (localThis && ts.isCallExpression(parent)) {
        const read = reflectiveInvocation(parent);
        if (read && !read.binding && read.args[0] === use && read.args.length >= 2) {
          reads.push(read.args[1]);
          return true;
        }
      }
      return false;
    }
    function inspect(current) {
      if (!safe) return;
      if (ts.isIdentifier(current) && literalObject(current) === root) {
        let use = current;
        while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
        const parent = use.parent;
        if (ts.isVariableDeclaration(parent) && parent.name === current) {
          // Binding name.
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === use &&
          ts.isIdentifier(parent.name) && constantInitializer(parent.name) === use) {
          // Immutable receiver alias, with all its uses checked below.
        } else if (!receiverUse(current)) safe = false;
      }
      ts.forEachChild(current, inspect);
    }
    if (safe) inspect(file);
    function inspectThis(current) {
      if (!safe) return;
      // A nested ordinary function owns a different this; it must establish
      // its own proof through receiverMayBeGlobal rather than inherit this one.
      if (current !== root && ts.isFunctionLike(current) && !ts.isArrowFunction(current) &&
        memberOf(current)?.parent !== root) return;
      if (current.kind === ts.SyntaxKind.ThisKeyword && !receiverUse(current)) safe = false;
      ts.forEachChild(current, inspectThis);
    }
    if (safe) inspectThis(root);
    // Validate only after the complete external/internal call set is collected.
    if (safe) safe = reads.every(confinedKey);
    receiverProof.set(root, safe);
    return safe;
  }
  function receiverMayBeGlobal(node) {
    let current = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isFunctionLike(current) && !ts.isArrowFunction(current)) {
        const member = ts.isMethodDeclaration(current) ? current :
          ts.isFunctionExpression(current) && ts.isPropertyAssignment(current.parent) ? current.parent : null;
        const root = member?.parent;
        return !(root && ts.isObjectLiteralExpression(root) && confinedReceiver(root));
      }
      if (ts.isClassLike(current)) return true;
      current = current.parent;
    }
    return true;
  }
  function memberName(node) {
    return ts.isPropertyAccessExpression(node) ? node.name.text :
      ts.isElementAccessExpression(node) ? staticPropertyName(node.argumentExpression) : undefined;
  }
  const namespaceProof = new Map();
  // A matching property name is relevant only if its receiver may own the
  // global slot. Fresh allocations are disjoint; nested own slots additionally
  // require stable ownership across every lexical alias and the complete graph.
  function writtenReference(node) {
    if (isMutation(node)) return true;
    let target = node;
    while (target.parent && (ts.isParenthesizedExpression(target.parent) ||
      ts.isPropertyAssignment(target.parent) && target.parent.initializer === target ||
      ts.isSpreadAssignment(target.parent) || ts.isSpreadElement(target.parent) ||
      ts.isObjectLiteralExpression(target.parent) || ts.isArrayLiteralExpression(target.parent))) {
      target = target.parent;
    }
    const parent = target.parent;
    return ts.isBinaryExpression(parent) && parent.left === target &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === target;
  }
  const localShapeProof = new Map();
  const localSlotProof = new Map();
  function localObjectShape(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (localShapeProof.has(node)) return localShapeProof.get(node);
    localShapeProof.set(node, undefined);
    let root;
    if (ts.isObjectLiteralExpression(node)) root = node;
    else if (ts.isIdentifier(node) && !globalAliases.has(aliasKey(node))) {
      const value = constantInitializer(node);
      if (value) root = localObjectShape(value, depth + 1);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = localObjectShape(node.expression, depth + 1);
      const key = memberName(node);
      const property = ownDataProperty(owner, key);
      if (property) root = localObjectShape(property.initializer, depth + 1);
    }
    localShapeProof.set(node, root);
    return root;
  }
  function ownDataProperty(root, key) {
    if (!root || key === undefined || ["__proto__", "prototype"].includes(key) ||
      root.properties.some(property => ts.isSpreadAssignment(property) ||
        propertyName(property) === undefined || propertyName(property) === "__proto__")) return undefined;
    const matches = root.properties.filter(property => propertyName(property) === key);
    return matches.length === 1 && ts.isPropertyAssignment(matches[0]) ? matches[0] : undefined;
  }
  function stableLocalSlot(root, key) {
    let proof = localSlotProof.get(root);
    if (!proof) localSlotProof.set(root, proof = new Map());
    if (proof.has(key)) return proof.get(key);
    proof.set(key, false);
    let safe = true;
    function inspect(node) {
      if (!safe) return;
      if ((ts.isIdentifier(node) && isValue(node) ||
        ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ||
        node === root) && localObjectShape(node) === root) {
        let use = node;
        while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
        const parent = use.parent;
        if (ts.isVariableDeclaration(parent) && parent.initializer === use &&
          ts.isIdentifier(parent.name) && constantInitializer(parent.name) === use) {
          // Const aliases are examined by allocation identity, not their names.
        } else if (node === root && ts.isPropertyAssignment(parent) &&
          parent.initializer === use && ts.isObjectLiteralExpression(parent.parent)) {
          // Nested literal ownership is checked at each containing slot.
        } else if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === use) {
          const name = memberName(parent);
          let access = parent;
          while (ts.isParenthesizedExpression(access.parent)) access = access.parent;
          // A method invoked with this owner may replace the slot. Unknown keys
          // and prototype escapes likewise cannot establish stable ownership.
          if (name === undefined || ["__proto__", "prototype"].includes(name) ||
            name === key && writtenReference(parent) ||
            ts.isCallExpression(access.parent) && access.parent.expression === access) safe = false;
        } else {
          // Returning/storing/passing the owner (including reflective mutation)
          // can replace the nested slot. An unproved escape remains fail-closed.
          safe = false;
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(file);
    proof.set(key, safe);
    return safe;
  }
  function ownedLocalReceiver(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (ts.isObjectLiteralExpression(node)) return true;
    if (ts.isIdentifier(node) && !globalAliases.has(aliasKey(node))) {
      const value = constantInitializer(node);
      return !!value && ownedLocalReceiver(value, depth + 1);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = localObjectShape(node.expression);
      const key = memberName(node);
      const property = ownDataProperty(owner, key);
      return !!property && ownedLocalReceiver(node.expression, depth + 1) &&
        stableLocalSlot(owner, key) && ownedLocalReceiver(property.initializer, depth + 1);
    }
    return false;
  }
  function nonCallableNamespace(member) {
    if (!(ts.isPropertyAccessExpression(member) || ts.isElementAccessExpression(member)) ||
      !workerGlobal(member.expression)) return false;
    const name = memberName(member);
    if (name === undefined) return false;
    if (namespaceProof.has(name)) return namespaceProof.get(name);
    namespaceProof.set(name, false);
    let value, writes = 0, safe = true;
    function inspect(node) {
      if (!safe) return;
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        writtenReference(node)) {
        const key = memberName(node);
        if ((key === name || key === undefined && workerGlobal(node.expression)) &&
          !ownedLocalReceiver(node.expression)) {
          let target = node;
          while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
          const assignment = target.parent;
          if (key !== name || !workerGlobal(node.expression) ||
            !ts.isBinaryExpression(assignment) || assignment.left !== target ||
            assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) safe = false;
          else { writes++; value = unwrap(assignment.right); }
        }
      }
      if (ts.isCallExpression(node) && node.arguments[0] && !ownedLocalReceiver(node.arguments[0])) {
        const callee = unwrap(node.expression);
        const owner = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
          intrinsicObject(callee.expression);
        const operation = memberName(callee);
        // Native writers of unrelated, proven-local objects do not replace this
        // global namespace. Unknown receivers/keys cannot be called disjoint.
        if ((owner === "Object" && operation === "defineProperty" ||
          owner === "Reflect" && ["defineProperty", "set", "deleteProperty"].includes(operation)) &&
          (!node.arguments[1] || staticPropertyName(node.arguments[1]) === name ||
            staticPropertyName(node.arguments[1]) === undefined && workerGlobal(node.arguments[0]))) safe = false;
        if (owner === "Object" && ["assign", "defineProperties"].includes(operation) &&
          node.arguments.slice(1).some(argument => {
            argument = unwrap(argument);
            return ts.isObjectLiteralExpression(argument) &&
              argument.properties.some(property => propertyName(property) === name);
          })) safe = false;
      }
      ts.forEachChild(node, inspect);
    }
    inspect(file);
    // A unique native freeze of a literal is an object, never a callable.
    // Its .call/.apply/.bind fields therefore name ordinary application methods.
    safe = safe && writes === 1 && ts.isCallExpression(value) &&
      memberName(unwrap(value.expression)) === "freeze" &&
      intrinsicObject(unwrap(value.expression).expression) === "Object" &&
      intrinsicMemberStable("freeze", "Object") && value.arguments.length === 1 &&
      !!literalObject(value.arguments[0]);
    namespaceProof.set(name, !!safe);
    return !!safe;
  }
  function memberInvocation(member) {
    let use = member;
    while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
    if (ts.isCallExpression(use.parent) && use.parent.expression === use)
      return {call: use.parent};
    const helper = use.parent;
    if ((ts.isPropertyAccessExpression(helper) || ts.isElementAccessExpression(helper)) &&
      helper.expression === use && ["call", "apply", "bind"].includes(memberName(helper))) {
      if (nonCallableNamespace(member)) return undefined;
      let target = helper;
      while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
      if (ts.isCallExpression(target.parent) && target.parent.expression === target)
        return {call: target.parent, helper: memberName(helper)};
    }
    return undefined;
  }
  // Native return protocols require the member identity to remain stable.
  // Writes through an unknown receiver/key or exposed prototype cannot prove it.
  function nativeMemberStable(name) {
    if (nativeMemberProof.has(name)) return nativeMemberProof.get(name);
    nativeMemberProof.set(name, false);
    let safe = true;
    function inspect(node) {
      if (!safe) return;
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const key = memberName(node);
        if (isMutation(node) && !literalObject(node.expression) &&
          (key === undefined || key === name || key === "__proto__")) safe = false;
        if (["prototype", "__proto__"].includes(key) && !literalObject(node.expression)) {
          let use = node;
          while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
          if (!((ts.isPropertyAccessExpression(use.parent) || ts.isElementAccessExpression(use.parent)) &&
            use.parent.expression === use)) safe = false;
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (["defineProperty", "defineProperties", "assign", "setPrototypeOf", "deleteProperty"]
          .includes(memberName(callee)) && node.arguments[0] &&
          !literalObject(node.arguments[0])) safe = false;
      }
      if (ts.isBindingElement(node) && ["prototype", "__proto__"].includes(bindingPropertyName(node))) {
        const owner = node.parent.parent;
        if (!ts.isVariableDeclaration(owner) || !owner.initializer ||
          !literalObject(owner.initializer)) safe = false;
      }
      ts.forEachChild(node, inspect);
    }
    inspect(file);
    nativeMemberProof.set(name, safe);
    return safe;
  }
  function nativeIdentityReceiver(call) {
    const callee = unwrap(call.expression);
    if (!(ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) return undefined;
    const name = memberName(callee);
    if (name === "valueOf" && call.arguments.length === 0 && nativeMemberStable("valueOf"))
      return callee.expression;
    // These Object operations return their first argument, including a native
    // target. Never erase that target when a write's result is later consumed.
    if (["assign", "defineProperty", "defineProperties", "freeze", "seal", "preventExtensions"]
      .includes(name) && call.arguments.length && intrinsicObject(callee.expression) === "Object" &&
      intrinsicMemberStable(name, "Object")) return call.arguments[0];
    return undefined;
  }
  function ordinaryNativeResult(name, intrinsic) {
    return name === "toString" || !intrinsic &&
      ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"].includes(name);
  }
  // A fixed Object/Reflect operation cannot manufacture a worker capability
  // from ordinary arguments. Capability arguments are still checked separately.
  // Unlike a blanket non-native assertion, its own member must stay unmodified.
  function ordinaryIntrinsicResult(name, owner) {
    return owner === "Object" && [
      "assign", "create", "defineProperty", "defineProperties", "entries", "freeze",
      "fromEntries", "getOwnPropertyNames", "getOwnPropertySymbols", "getPrototypeOf",
      "hasOwn", "is", "isExtensible", "isFrozen", "isSealed", "keys",
      "preventExtensions", "seal", "values",
    ].includes(name) || owner === "Reflect" && [
      "defineProperty", "deleteProperty", "getPrototypeOf", "has", "isExtensible",
      "ownKeys", "preventExtensions", "set", "setPrototypeOf",
    ].includes(name);
  }
  function intrinsicMemberStable(name, owner) {
    const key = owner + ":" + name;
    if (nativeMemberProof.has(key)) return nativeMemberProof.get(key);
    nativeMemberProof.set(key, false);
    let safe = true;
    function inspect(node) {
      if (!safe) return;
      if (ts.isIdentifier(node) && node.text === owner &&
        !bindingDeclarations(node)?.length && isMutation(node)) safe = false;
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        isMutation(node)) {
        const target = intrinsicObject(node.expression);
        const property = memberName(node);
        if (target === owner && [undefined, name, "__proto__"].includes(property) ||
          workerGlobal(node.expression) && [undefined, owner].includes(property)) safe = false;
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const operation = memberName(callee);
        if (["assign", "defineProperty", "defineProperties", "setPrototypeOf", "set", "deleteProperty"]
          .includes(operation) && node.arguments[0] &&
          intrinsicObject(node.arguments[0]) === owner &&
          (["assign", "defineProperties", "setPrototypeOf"].includes(operation) ||
            !node.arguments[1] || [undefined, name, "__proto__"]
              .includes(staticPropertyName(node.arguments[1])))) safe = false;
      }
      ts.forEachChild(node, inspect);
    }
    inspect(file);
    nativeMemberProof.set(key, safe);
    return safe;
  }
  const discardedProof = new Map();
  function discardedResult(node) {
    if (discardedProof.has(node)) return discardedProof.get(node);
    discardedProof.set(node, false); // Cyclic/recursive flow is not a proof.
    let use = node;
    while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
    const parent = use.parent;
    let safe = ts.isExpressionStatement(parent) || ts.isVoidExpression(parent) ||
      ts.isTypeOfExpression(parent) ||
      ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken ||
      ts.isBinaryExpression(parent) && (
        parent.operatorToken.kind === ts.SyntaxKind.CommaToken && parent.left === use ||
        [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
         ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
          .includes(parent.operatorToken.kind)) ||
      (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) &&
        parent.expression === use ||
      ts.isConditionalExpression(parent) && parent.condition === use;
    if (!safe && (ts.isAwaitExpression(parent) ||
      ts.isConditionalExpression(parent) && [parent.whenTrue, parent.whenFalse].includes(use) ||
      ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.CommaToken]
        .includes(parent.operatorToken.kind))) safe = discardedResult(parent);
    function allReferences(binding) {
      const symbol = symbolAt(binding);
      if (!symbol) return false;
      let result = true;
      function inspect(current) {
        if (!result) return;
        if (ts.isIdentifier(current) && current !== binding &&
          symbolAt(current) === symbol && isValue(current) && !discardedResult(current)) result = false;
        ts.forEachChild(current, inspect);
      }
      inspect(file);
      return result;
    }
    if (!safe && ts.isVariableDeclaration(parent) && parent.initializer === use &&
      ts.isIdentifier(parent.name)) safe = allReferences(parent.name);
    function functionResult(fn) {
      let value = fn;
      while (ts.isParenthesizedExpression(value.parent)) value = value.parent;
      if (ts.isCallExpression(value.parent) && value.parent.expression === value)
        return discardedResult(value.parent);
      const binding = ts.isFunctionDeclaration(fn) ? fn.name :
        ts.isVariableDeclaration(value.parent) && value.parent.initializer === value &&
          ts.isIdentifier(value.parent.name) && constantInitializer(value.parent.name) === value ?
          value.parent.name : undefined;
      if (!binding) return false;
      const symbol = symbolAt(binding);
      let result = !!symbol;
      function inspect(current) {
        if (!result) return;
        if (ts.isIdentifier(current) && current !== binding && symbolAt(current) === symbol &&
          isValue(current)) {
          let reference = current;
          while (ts.isParenthesizedExpression(reference.parent)) reference = reference.parent;
          const call = reference.parent;
          if (!ts.isCallExpression(call) || call.expression !== reference ||
            !discardedResult(call)) result = false;
        }
        ts.forEachChild(current, inspect);
      }
      inspect(file);
      return result;
    }
    if (!safe && ts.isReturnStatement(parent)) {
      let fn = parent.parent;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      if (fn) safe = functionResult(fn);
    }
    if (!safe && ts.isArrowFunction(parent) && parent.body === use) safe = functionResult(parent);
    discardedProof.set(node, !!safe);
    return !!safe;
  }
  function nativeCallPolicy(member, intrinsic) {
    const invocation = memberInvocation(member);
    if (!invocation) return undefined;
    if (reflectiveInvocation(invocation.call)) return "tracked";
    if (!invocation.helper && nativeIdentityReceiver(invocation.call)) return "identity";
    const owner = intrinsicObject(member.expression) || (typeof intrinsic === "string" ? intrinsic : undefined);
    if (ordinaryIntrinsicResult(memberName(member), owner) &&
      intrinsicMemberStable(memberName(member), owner) && !invocation.helper) return "ordinary";
    if (ordinaryNativeResult(memberName(member), intrinsic) &&
      nativeMemberStable(memberName(member)) &&
      (!invocation.helper || nativeMemberStable(invocation.helper))) return "ordinary";
    return "opaque";
  }
  function nativeMemberUse(member, intrinsic) {
    // Existing dynamic/name guards own these diagnostics and remain mandatory.
    if (memberName(member) === undefined || memberName(member) === "importScripts") return true;
    const policy = nativeCallPolicy(member, intrinsic);
    if (!policy) {
      const owner = intrinsicObject(member.expression) || (typeof intrinsic === "string" ? intrinsic : undefined);
      return ordinaryIntrinsicResult(memberName(member), owner) ?
        intrinsicMemberStable(memberName(member), owner) :
        !ordinaryNativeResult(memberName(member), intrinsic) || nativeMemberStable(memberName(member));
    }
    return policy !== "opaque" || discardedResult(memberInvocation(member).call);
  }
  function nativeParameterUse(node, intrinsic, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    let use = node;
    while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
    const parent = use.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === use) {
      const name = memberName(parent);
      if (intrinsic && isMutation(parent)) return false;
      if (name === undefined ||
        ["importScripts", "self", "globalThis", "Reflect", "Object", "constructor", "__proto__", "eval"].includes(name) ||
        intrinsic && ["get", "getOwnPropertyDescriptor"].includes(name)) return false;
      const policy = nativeCallPolicy(parent, intrinsic);
      if (policy === "identity")
        return nativeParameterUse(memberInvocation(parent).call, intrinsic, depth + 1);
      return nativeMemberUse(parent, intrinsic);
    }
    if (!intrinsic && ts.isCallExpression(parent) && globalWriteInvocation(parent, use))
      return nativeIdentityReceiver(parent) === use ?
        nativeParameterUse(parent, intrinsic, depth + 1) : true;
    if (discardedResult(node)) return true;
    return ts.isTypeOfExpression(parent) || ts.isVoidExpression(parent) ||
      ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken ||
      ts.isBinaryExpression(parent) && [
        ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(parent.operatorToken.kind);
  }
  function globalWriteInvocation(call, target) {
    const callee = unwrap(call.expression);
    if (!(ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) ||
      call.arguments[0] !== target) return false;
    const owner = intrinsicObject(callee.expression);
    const name = memberName(callee);
    if (!intrinsicMemberStable(name, owner)) return false;
    const reserved = [undefined, "importScripts", "self", "globalThis", "Reflect", "Object",
      "constructor", "__proto__", "eval"];
    if (["Object", "Reflect"].includes(owner) && name === "defineProperty")
      return call.arguments.length === 3 && !reserved.includes(staticPropertyName(call.arguments[1]));
    if (owner === "Object" && ["assign", "defineProperties"].includes(name)) {
      return call.arguments.length >= 2 && call.arguments.slice(1).every(value => {
        value = unwrap(value);
        return ts.isObjectLiteralExpression(value) && value.properties.every(property =>
          !ts.isSpreadAssignment(property) && !reserved.includes(propertyName(property)));
      });
    }
    return false;
  }
  function directCallReference(node) {
    let use = node;
    while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
    return ts.isCallExpression(use.parent) && use.parent.expression === use;
  }
  function intrinsicObject(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      if (["Reflect", "Object"].includes(node.text) && !bindingDeclarations(node)?.length) return node.text;
      const initializer = constantInitializer(node);
      if (initializer) return intrinsicObject(initializer, depth + 1);
      const declarations = bindingDeclarations(node);
      const binding = declarations?.length === 1 ? declarations[0] : undefined;
      if (binding && ts.isBindingElement(binding) && bindingSourceIsGlobal(binding, depth + 1)) {
        const name = bindingPropertyName(binding);
        if (["Reflect", "Object"].includes(name)) return name;
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : staticPropertyName(node.argumentExpression);
      if (["Reflect", "Object"].includes(name) && workerGlobal(node.expression, depth + 1)) return name;
      if (name === "value" && ts.isCallExpression(unwrap(node.expression))) {
        const read = reflectiveInvocation(unwrap(node.expression), depth + 1);
        if (read?.api === "descriptor" && !read.binding && read.args.length >= 2) {
          const key = staticPropertyName(read.args[1]);
          if (["Reflect", "Object"].includes(key) && workerGlobal(read.args[0], depth + 1)) return key;
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const receiver = nativeIdentityReceiver(node);
      if (receiver) return intrinsicObject(receiver, depth + 1);
      const read = reflectiveInvocation(node, depth + 1);
      if (read?.api === "get" && !read.binding && read.args.length >= 2) {
        const name = staticPropertyName(read.args[1]);
        if (["Reflect", "Object"].includes(name) && workerGlobal(read.args[0], depth + 1)) return name;
      }
    }
    return undefined;
  }
  function reflectiveMember(owner, name) {
    if (owner === "Reflect" && name === "get") return "get";
    if (owner === "Object" && name === "getOwnPropertyDescriptor") return "descriptor";
    return undefined;
  }
  // Resolve immutable intrinsic aliases by symbol, including destructuring.
  // Escapes and argument forms we cannot normalize are rejected by visit.
  function reflectiveFunction(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const initializer = constantInitializer(node);
      if (initializer) return reflectiveFunction(initializer, depth + 1);
      const declarations = bindingDeclarations(node);
      const binding = declarations?.length === 1 ? declarations[0] : undefined;
      if (binding && ts.isBindingElement(binding) && !binding.dotDotDotToken && !binding.initializer &&
        ts.isObjectBindingPattern(binding.parent) && ts.isIdentifier(binding.name)) {
        const owner = binding.parent.parent;
        if (ts.isVariableDeclaration(owner) && owner.initializer &&
          ts.isVariableDeclarationList(owner.parent) && (owner.parent.flags & ts.NodeFlags.Const)) {
          const api = reflectiveMember(intrinsicObject(owner.initializer, depth + 1), bindingPropertyName(binding));
          if (api) return {api, bound: []};
        }
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = intrinsicObject(node.expression, depth + 1);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : staticPropertyName(node.argumentExpression);
      if (owner && name === undefined) throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
      const api = reflectiveMember(owner, name);
      if (api) return {api, bound: []};
      if (name === "value" && ts.isCallExpression(unwrap(node.expression))) {
        const read = reflectiveInvocation(unwrap(node.expression), depth + 1);
        if (read?.api === "descriptor" && !read.binding && read.args.length >= 2) {
          const accessor = reflectiveMember(intrinsicObject(read.args[0], depth + 1),
            staticPropertyName(read.args[1]));
          if (accessor) return {api: accessor, bound: []};
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const invocation = reflectiveInvocation(node, depth + 1);
      if (invocation?.binding) return {api: invocation.api, bound: invocation.args};
      if (invocation?.api === "get" && invocation.args.length >= 2) {
        const api = reflectiveMember(intrinsicObject(invocation.args[0], depth + 1),
          staticPropertyName(invocation.args[1]));
        if (api) return {api, bound: []};
      }
    }
    return undefined;
  }
  function reflectiveInvocation(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    const expression = unwrap(node.expression);
    let fn = reflectiveFunction(expression, depth + 1);
    let args = Array.from(node.arguments);
    let binding = false;
    if (!fn && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))) {
      fn = reflectiveFunction(expression.expression, depth + 1);
      if (!fn) return undefined;
      const name = ts.isPropertyAccessExpression(expression) ? expression.name.text :
        staticPropertyName(expression.argumentExpression);
      if (name === "call" || name === "bind") {
        args = args.slice(1);
        binding = name === "bind";
      } else if (name === "apply") {
        const array = args[1] && unwrap(args[1]);
        if (!array || !ts.isArrayLiteralExpression(array) ||
          array.elements.some(item => ts.isSpreadElement(item) || ts.isOmittedExpression(item))) {
          throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
        }
        args = Array.from(array.elements);
      } else {
        throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
      }
    }
    if (!fn) return undefined;
    if (args.some(arg => ts.isSpreadElement(arg))) {
      throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
    }
    return {api: fn.api, args: fn.bound.concat(args), binding};
  }
  function reflectiveReferenceUse(node) {
    let use = node;
    while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
    const parent = use.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === use &&
      ts.isIdentifier(parent.name) && constantInitializer(parent.name) === use) return true;
    if (ts.isCallExpression(parent) && parent.expression === use) return true;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === use) {
      const name = ts.isPropertyAccessExpression(parent) ? parent.name.text : staticPropertyName(parent.argumentExpression);
      if (["call", "apply", "bind"].includes(name)) {
        let memberUse = parent;
        while (ts.isParenthesizedExpression(memberUse.parent)) memberUse = memberUse.parent;
        return ts.isCallExpression(memberUse.parent) && memberUse.parent.expression === memberUse;
      }
    }
    return false;
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
    if (node.kind === ts.SyntaxKind.ThisKeyword) return receiverMayBeGlobal(node);
    if (ts.isIdentifier(node)) {
      if (globalAliases.has(aliasKey(node))) return true;
      if (["self", "globalThis"].includes(node.text) && !bindingDeclarations(node)?.length) {
        return true;
      }
      const declarations = bindingDeclarations(node);
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
    if (ts.isCallExpression(node)) {
      const receiver = nativeIdentityReceiver(node);
      if (receiver) return workerGlobal(receiver, depth + 1);
      const read = reflectiveInvocation(node, depth + 1);
      return !!read && !read.binding && read.api === "get" && read.args.length >= 2 &&
        ["self", "globalThis"].includes(staticPropertyName(read.args[1])) &&
        workerGlobal(read.args[0], depth + 1);
    }
    const name = ts.isPropertyAccessExpression(node) ? node.name.text :
      ts.isElementAccessExpression(node) ? staticPropertyName(node.argumentExpression) : undefined;
    if (name === "value" && ts.isCallExpression(unwrap(node.expression))) {
      const read = reflectiveInvocation(unwrap(node.expression), depth + 1);
      if (read?.api === "descriptor" && !read.binding && read.args.length >= 2 &&
        ["self", "globalThis"].includes(staticPropertyName(read.args[1]))) {
        return workerGlobal(read.args[0], depth + 1);
      }
    }
    return ["self", "globalThis"].includes(name) && workerGlobal(node.expression, depth + 1);
  }
  // Native origins may cross only a boundary whose value uses we can prove.
  // This is deliberately not an assumption that an unresolved parameter is
  // ordinary: dynamic helper calls with local objects remain unrestricted.
  const callableProof = new Map();
  function knownFunction(node, depth = 0) {
    if (depth > 64) throw new Error("IMPORT_SCRIPTS_COMPUTED_REFERENCE_TOO_COMPLEX");
    node = unwrap(node);
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return node;
    if (ts.isIdentifier(node)) {
      const declarations = bindingDeclarations(node);
      if (declarations?.length !== 1) return undefined;
      const fn = declarations[0];
      if (ts.isFunctionDeclaration(fn)) {
        if (!callableProof.has(fn)) {
          let stable = true;
          function inspect(current) {
            if (ts.isIdentifier(current) && symbolAt(current) === symbolAt(node) &&
              isMutation(current)) stable = false;
            ts.forEachChild(current, inspect);
          }
          inspect(file);
          callableProof.set(fn, stable);
        }
        return callableProof.get(fn) ? fn : undefined;
      }
      const value = constantInitializer(node);
      return value ? knownFunction(value, depth + 1) : undefined;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const root = literalObject(node.expression);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : staticPropertyName(node.argumentExpression);
      if (!root || name === undefined || !confinedReceiver(root)) return undefined;
      const member = root.properties.find(item => propertyName(item) === name);
      if (member && ts.isMethodDeclaration(member)) return member;
      if (member && ts.isPropertyAssignment(member)) return knownFunction(member.initializer, depth + 1);
    }
    return undefined;
  }
  function benignParameter(fn, parameter, intrinsic) {
    if (!parameter || !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken ||
      parameter.initializer || !fn.body) return false;
    const symbol = symbolAt(parameter.name);
    let safe = true;
    function inspect(node) {
      if (!safe) return;
      if (ts.isIdentifier(node) && node.text === "arguments" && isValue(node) &&
        !bindingDeclarations(node)?.length) {
        let owner = node.parent;
        while (owner && (!ts.isFunctionLike(owner) || ts.isArrowFunction(owner))) owner = owner.parent;
        if (owner === fn) safe = false;
      }
      if (ts.isIdentifier(node) && node.text === "eval" && isValue(node) &&
        directCallReference(node) && !knownFunction(node)) safe = false;
      if (ts.isIdentifier(node) && node !== parameter.name && symbolAt(node) === symbol) {
        if (!nativeParameterUse(node, intrinsic)) safe = false;
      }
      ts.forEachChild(node, inspect);
    }
    // Other parameter defaults execute before the body and can use this origin.
    inspect(fn);
    return safe;
  }
  function callCapabilityUse(call, value, intrinsic) {
    const read = reflectiveInvocation(call);
    if (read) return true; // The shared receiver/key guard validates this call.
    if (!intrinsic && globalWriteInvocation(call, value)) return true;
    const callee = unwrap(call.expression);
    let fn = knownFunction(callee);
    let args = Array.from(call.arguments);
    // Unknown invocation helpers, bound function aliases and apply arrays
    // cannot prove formal-parameter identity. Recognized native reflection
    // helpers were normalized above; all other capability escapes fail closed.
    if (!fn || args.some(arg => ts.isSpreadElement(arg))) return false;
    const index = args.indexOf(value);
    return index >= 0 && benignParameter(fn, fn.parameters[index], intrinsic);
  }
  function capabilityUse(node, intrinsic) {
    let use = node;
    while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
    const parent = use.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === use) return nativeMemberUse(parent, intrinsic);
    if (ts.isVariableDeclaration(parent) && parent.initializer === use) {
      if (!intrinsic) return ts.isIdentifier(parent.name) || ts.isObjectBindingPattern(parent.name);
      return ts.isVariableDeclarationList(parent.parent) &&
        !!(parent.parent.flags & ts.NodeFlags.Const) &&
        (ts.isIdentifier(parent.name) || ts.isObjectBindingPattern(parent.name));
    }
    if (!intrinsic && ts.isBinaryExpression(parent) && parent.right === use &&
      [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]
        .includes(parent.operatorToken.kind)) {
      const target = unwrap(parent.left);
      return ts.isIdentifier(target) || ts.isObjectLiteralExpression(target);
    }
    if (ts.isConditionalExpression(parent) && (parent.whenTrue === use || parent.whenFalse === use)) {
      return capabilityUse(parent, intrinsic);
    }
    if (ts.isBinaryExpression(parent) && [
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.CommaToken,
    ].includes(parent.operatorToken.kind)) {
      return parent.operatorToken.kind === ts.SyntaxKind.CommaToken && parent.left === use ||
        capabilityUse(parent, intrinsic);
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      // A function with no Identifier references can still be reached through
      // global properties, reflection or destructuring. Never waive an opaque
      // capability argument because its enclosing function looks unreferenced.
      return !ts.isNewExpression(parent) && callCapabilityUse(parent, use, intrinsic);
    }
    if (ts.isArrayLiteralExpression(parent)) {
      let arrayUse = parent;
      while (ts.isParenthesizedExpression(arrayUse.parent)) arrayUse = arrayUse.parent;
      return ts.isCallExpression(arrayUse.parent) &&
        callCapabilityUse(arrayUse.parent, use, intrinsic);
    }
    return ts.isExpressionStatement(parent) || ts.isTypeOfExpression(parent) ||
      (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) ||
      (ts.isBinaryExpression(parent) && [
        ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(parent.operatorToken.kind));
  }
  function isValue(node) {
    if (node.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) return true;
    if (!ts.isIdentifier(node)) return false;
    const parent = node.parent;
    if (ts.isShorthandPropertyAssignment(parent)) return true;
    if (parent.name === node || parent.propertyName === node ||
      (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) &&
        parent.label === node) return false;
    // Destructuring assignment targets are writes, not capability reads.
    let target = node;
    while (target.parent && (
      ts.isParenthesizedExpression(target.parent) ||
      ts.isShorthandPropertyAssignment(target.parent) ||
      ts.isPropertyAssignment(target.parent) && target.parent.initializer === target ||
      ts.isObjectLiteralExpression(target.parent) || ts.isArrayLiteralExpression(target.parent)
    )) target = target.parent;
    if (ts.isBinaryExpression(target.parent) && target.parent.left === target &&
      target.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return false;
    return !isMutation(node);
  }
  function isPureWrite(node) {
    let target = node;
    while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
    const parent = target.parent;
    return ts.isBinaryExpression(parent) && parent.left === target &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  }
  function visit(node) {
    if (isValue(node)) {
      const intrinsic = intrinsicObject(node);
      if ((intrinsic || workerGlobal(node)) && !capabilityUse(node, intrinsic)) {
        throw new Error(intrinsic ? "IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE" :
          "IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
      }
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const owner = node.parent.parent;
      if (ts.isVariableDeclaration(owner) && owner.initializer && intrinsicObject(owner.initializer)) {
        const name = bindingPropertyName(node);
        if (node.dotDotDotToken || name === undefined ||
          (reflectiveMember(intrinsicObject(owner.initializer), name) &&
           (!ts.isVariableDeclarationList(owner.parent) || !(owner.parent.flags & ts.NodeFlags.Const) ||
            !ts.isIdentifier(node.name) || node.initializer))) {
          throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const read = reflectiveInvocation(node);
      if (read && read.args.length >= 2) {
        const name = staticPropertyName(read.args[1]);
        if (name === "importScripts" && !ordinaryObject(read.args[0])) {
          throw new Error("IMPORT_SCRIPTS_UNSUPPORTED_REFERENCE");
        }
        if (name === undefined && workerGlobal(read.args[0])) {
          throw new Error("IMPORT_SCRIPTS_UNRESOLVED_GLOBAL_REFERENCE");
        }
        if (name === undefined && intrinsicObject(read.args[0])) {
          throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
        }
      }
    }
    // Track supported intrinsic aliases instead of allowing the callable to
    // escape into opaque storage, parameters or another invocation mechanism.
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node) ||
      (ts.isIdentifier(node) && (node.parent.name !== node || ts.isShorthandPropertyAssignment(node.parent)))) && reflectiveFunction(node) &&
      !reflectiveReferenceUse(node)) {
      throw new Error("IMPORT_SCRIPTS_UNRESOLVED_REFLECTIVE_REFERENCE");
    }
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
    ts.forEachChild(node, visit);
  }
  function scanImports(node) {
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
    ts.forEachChild(node, scanImports);
  }
  scanImports(file);
  const validated = mode === "validate" || mode === "scan-root" && imports.length === 0;
  if (validated) {
    collectGlobalAliases();
    visit(file);
  }
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
  const locations = imports.map(item => ({
    start: toCodePointOffset(item.start),
    end: toCodePointOffset(item.end),
    paths: item.paths,
  }));
  return mode === "scan-root" ? {imports: locations, validated} : locations;
}

module.exports = {locate};
if (require.main === module) {
  try {
    const source = fs.readFileSync(0, "utf8");
    const mode = process.argv.length === 2 ? "validate" :
      process.argv.length === 3 && process.argv[2] === "--imports-only" ? "imports-only" :
      process.argv.length === 3 && process.argv[2] === "--scan-root" ? "scan-root" : "invalid";
    const imports = locate(source, mode);
    process.stdout.write(JSON.stringify(imports) + "\n");
  } catch (error) {
    process.stderr.write(String(error.message || "JS_AST_PARSE_FAILED").slice(0, 320) + "\n");
    process.exitCode = 1;
  }
}
