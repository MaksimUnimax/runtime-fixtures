/**
 * ACW1 / ACJ1 byte codec, reviewed FINAL v2.
 * Dedicated to account-code wire data. No crypto, auth, storage or bootstrap edits.
 * Raw parsing is essential: JSON.parse loses duplicate keys and numeric lexemes.
 */
export type Acj1Value =
  | null | boolean | number | string
  | Acj1Value[] | { [key: string]: Acj1Value };
export type Acj1Input = string | Uint8Array;

export class Acj1Error extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code); // Never echo input, tickets or credentials.
    this.name = "Acj1Error";
    this.code = code;
  }
}
function fail(code: string): never { throw new Acj1Error(code); }
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ascii = (s: string): boolean => /^[\x00-\x7f]*$/.test(s);

export function assertScalarString(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("ACJ1_SCALAR");
    } else if (c >= 0xdc00 && c <= 0xdfff) fail("ACJ1_SCALAR");
  }
}
function limitValid(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) fail("ACJ1_LIMIT");
}
export function utf8Bytes(value: string): Uint8Array {
  assertScalarString(value);
  return encoder.encode(value);
}
function inputText(input: Acj1Input, maxBytes: number): string {
  limitValid(maxBytes);
  if (typeof input === "string") {
    if (input.length > maxBytes) fail("ACJ1_LIMIT");
    assertScalarString(input);
    if (encoder.encode(input).length > maxBytes) fail("ACJ1_LIMIT");
    return input;
  }
  if (!(input instanceof Uint8Array) || input.byteLength > maxBytes)
    fail("ACJ1_LIMIT");
  try { return decoder.decode(input); }
  catch { return fail("ACJ1_UTF8"); }
}

type ArrayFrame = { kind: "array"; value: Acj1Value[]; state: "first" | "value" | "comma" };
type ObjectFrame = {
  kind: "object"; value: { [key: string]: Acj1Value };
  state: "first" | "key" | "colon" | "value" | "comma";
  keys: Set<string>; key: string;
};

/** Strict ACJ1-domain raw JSON, allowing ordinary wire JSON whitespace/escaping.
 * Default cap is a request/plaintext cap; response callers pass 16384 explicitly.
 * Iterative containers avoid inventing a depth limit for otherwise bounded JSON.
 */
export function parseAcj1(input: Acj1Input, maxBytes = 8192): Acj1Value {
  const text = inputText(input, maxBytes);
  const stack: (ArrayFrame | ObjectFrame)[] = [];
  let at = 0, hasRoot = false, root: Acj1Value = null;
  const ws = () => { while (/[ \t\r\n]/.test(text[at] ?? "\0")) at++; };
  const string = (): string => {
    if (text[at++] !== '"') return fail("ACJ1_STRING");
    let value = "";
    while (at < text.length) {
      const c = text[at++]!;
      if (c === '"') { assertScalarString(value); return value; }
      if (c.charCodeAt(0) < 32) return fail("ACJ1_STRING");
      if (c !== "\\") { value += c; continue; }
      const escape = text[at++];
      const simple: Record<string, string> = {
        '"': '"', "\\": "\\", "/": "/", b: "\b", t: "\t",
        n: "\n", f: "\f", r: "\r",
      };
      if (escape !== undefined && Object.hasOwn(simple, escape)) {
        value += simple[escape]; continue;
      }
      if (escape !== "u") return fail("ACJ1_STRING");
      const hex = text.slice(at, at + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail("ACJ1_STRING");
      value += String.fromCharCode(Number.parseInt(hex, 16)); at += 4;
    }
    return fail("ACJ1_STRING");
  };
  const attach = (value: Acj1Value): void => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      if (hasRoot) fail("ACJ1_TRAILING");
      root = value; hasRoot = true; return;
    }
    if (parent.kind === "array") {
      parent.value.push(value); parent.state = "comma";
    } else {
      Object.defineProperty(parent.value, parent.key, {
        value, enumerable: true, configurable: true, writable: true,
      });
      parent.state = "comma";
    }
  };
  const value = (): void => {
    ws();
    const c = text[at];
    if (c === "{") {
      at++; const object: { [key: string]: Acj1Value } = {};
      attach(object);
      stack.push({ kind: "object", value: object, keys: new Set(), key: "", state: "first" });
    } else if (c === "[") {
      at++; const array: Acj1Value[] = []; attach(array);
      stack.push({ kind: "array", value: array, state: "first" });
    } else if (c === '"') attach(string());
    else if (c === "t" && text.slice(at, at + 4) === "true") { at += 4; attach(true); }
    else if (c === "f" && text.slice(at, at + 5) === "false") { at += 5; attach(false); }
    else if (c === "n" && text.slice(at, at + 4) === "null") { at += 4; attach(null); }
    else if (c !== undefined && c >= "0" && c <= "9") {
      const start = at;
      while (text[at] !== undefined && text[at]! >= "0" && text[at]! <= "9") at++;
      const digits = text.slice(start, at);
      if ((digits.length > 1 && digits[0] === "0") || /[.eE+-]/.test(text[at] ?? "\0"))
        fail("ACJ1_NUMBER");
      const number = Number(digits);
      if (!Number.isSafeInteger(number)) fail("ACJ1_NUMBER");
      attach(number);
    } else if (c === "-" || c === "+") fail("ACJ1_NUMBER");
    else fail("ACJ1_SYNTAX");
  };
  while (true) {
    ws();
    const frame = stack[stack.length - 1];
    if (!frame) {
      if (!hasRoot) { value(); continue; }
      if (at !== text.length) fail("ACJ1_TRAILING");
      return root;
    }
    if (frame.kind === "array") {
      if (frame.state === "first" && text[at] === "]") { at++; stack.pop(); continue; }
      if (frame.state === "first" || frame.state === "value") { value(); continue; }
      if (text[at] === ",") { at++; frame.state = "value"; continue; }
      if (text[at] === "]") { at++; stack.pop(); continue; }
      fail("ACJ1_SYNTAX");
    } else {
      if (frame.state === "first" && text[at] === "}") { at++; stack.pop(); continue; }
      if (frame.state === "first" || frame.state === "key") {
        const key = string();
        if (!ascii(key)) fail("ACJ1_KEY");
        if (frame.keys.has(key)) fail("ACJ1_DUPLICATE_KEY");
        frame.keys.add(key); frame.key = key; frame.state = "colon"; continue;
      }
      if (frame.state === "colon") {
        if (text[at++] !== ":") fail("ACJ1_SYNTAX");
        frame.state = "value"; continue;
      }
      if (frame.state === "value") { value(); continue; }
      if (text[at] === ",") { at++; frame.state = "key"; continue; }
      if (text[at] === "}") { at++; stack.pop(); continue; }
      fail("ACJ1_SYNTAX");
    }
  }
}

type EncodeJob =
  | { kind: "value"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "exit"; value: object };
export function encodeAcj1(value: unknown, maxBytes = 8192): Uint8Array {
  limitValid(maxBytes);
  const parts: string[] = [], active = new Set<object>();
  const jobs: EncodeJob[] = [{ kind: "value", value }];
  let bytes = 0;
  const append = (text: string) => {
    bytes += encoder.encode(text).length;
    if (bytes > maxBytes) fail("ACJ1_LIMIT");
    parts.push(text);
  };
  while (jobs.length) {
    const job = jobs.pop()!;
    if (job.kind === "text") { append(job.text); continue; }
    if (job.kind === "exit") { active.delete(job.value); continue; }
    const v = job.value;
    if (v === null) { append("null"); continue; }
    if (typeof v === "boolean") { append(v ? "true" : "false"); continue; }
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v) || v < 0 || Object.is(v, -0)) fail("ACJ1_NUMBER");
      append(String(v)); continue;
    }
    if (typeof v === "string") {
      if (v.length > maxBytes) fail("ACJ1_LIMIT");
      assertScalarString(v); append(JSON.stringify(v)); continue;
    }
    if (typeof v !== "object") fail("ACJ1_VALUE");
    if (active.has(v)) fail("ACJ1_CYCLE");
    const array = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (!array && proto !== Object.prototype && proto !== null) fail("ACJ1_VALUE");
    const keys = Reflect.ownKeys(v);
    const descriptors: Record<string, PropertyDescriptor> = {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || !ascii(key)) fail("ACJ1_KEY");
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!d.enumerable || !Object.hasOwn(d, "value")) fail("ACJ1_VALUE");
      Object.defineProperty(descriptors, key, { value: d, enumerable: true });
    }
    active.add(v); jobs.push({ kind: "exit", value: v });
    if (array) {
      const a = v as unknown[];
      if (keys.length !== a.length + 1) fail("ACJ1_VALUE");
      append("["); jobs.push({ kind: "text", text: "]" });
      for (let i = a.length - 1; i >= 0; i--) {
        const d = descriptors[String(i)]; if (!d) fail("ACJ1_VALUE");
        jobs.push({ kind: "value", value: d.value });
        if (i > 0) jobs.push({ kind: "text", text: "," });
      }
    } else {
      append("{"); jobs.push({ kind: "text", text: "}" });
      const sorted = Object.keys(descriptors).sort();
      for (let i = sorted.length - 1; i >= 0; i--) {
        const key = sorted[i]!;
        jobs.push({ kind: "value", value: descriptors[key]!.value });
        jobs.push({ kind: "text", text: (i ? "," : "") + JSON.stringify(key) + ":" });
      }
    }
  }
  return encoder.encode(parts.join(""));
}
export function parseCanonicalAcj1(input: Acj1Input, maxBytes = 8192): Acj1Value {
  const text = inputText(input, maxBytes), value = parseAcj1(text, maxBytes);
  if (decoder.decode(encodeAcj1(value, maxBytes)) !== text) fail("ACJ1_NONCANONICAL");
  return value;
}
export function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeBase64url(value: string, length?: number, maxBytes = 8192): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) ||
      value.length % 4 === 1 || value.length > Math.ceil(maxBytes * 4 / 3))
    fail("ACJ1_BASE64URL");
  let binary: string;
  try { binary = atob(value.replace(/-/g, "+").replace(/_/g, "/")); }
  catch { return fail("ACJ1_BASE64URL"); }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (bytes.length > maxBytes || (length !== undefined && bytes.length !== length) ||
      encodeBase64url(bytes) !== value) fail("ACJ1_BASE64URL");
  return bytes;
}
/** Pure F framing only; no SHA/MAC/signing or key material is constructed. */
export function frameAcw1(label: string, ...fields: Uint8Array[]): Uint8Array {
  if (!ascii(label) || label.length > 65535 || fields.length > 65535)
    fail("ACW1_FRAME");
  let size = 8 + label.length;
  for (const field of fields) {
    if (!(field instanceof Uint8Array) || field.length > 0xffffffff) fail("ACW1_FRAME");
    size += 4 + field.length;
    if (!Number.isSafeInteger(size)) fail("ACW1_FRAME");
  }
  let result: Uint8Array;
  try { result = new Uint8Array(size); } catch { return fail("ACW1_FRAME"); }
  result.set(encoder.encode("ACW1"), 0);
  const view = new DataView(result.buffer);
  view.setUint16(4, label.length, false);
  result.set(encoder.encode(label), 6);
  view.setUint16(6 + label.length, fields.length, false);
  let at = 8 + label.length;
  for (const field of fields) {
    view.setUint32(at, field.length, false); at += 4;
    result.set(field, at); at += field.length;
  }
  return result;
}
