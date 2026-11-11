import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Offline source harness only. Package specifiers use Node's native resolver
// and declared exports through an own local workspace-link fixture.
const route = pathToFileURL(fileURLToPath(new URL("../app/api/control-plane/[...path]/route.ts", import.meta.url))).href;
const normalizer = new URL("./control-plane-route.ts", import.meta.url).href;
const client = new URL("./control-plane.ts", import.meta.url).href;
const devices = new URL("../app/devices/page.tsx", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === route && specifier === "../../../../lib/control-plane-route") return next(normalizer, context);
    if (context.parentURL === devices && specifier === "../../lib/control-plane") return next(client, context);
    if (context.parentURL === devices && specifier === "../../lib/device-client-metadata")
      return next(new URL("./device-client-metadata.ts", import.meta.url).href, context);
    if (context.parentURL === devices && specifier === "react") return { url: "data:text/javascript,export const useEffect=(...a)=>globalThis.__hooks.useEffect(...a);export const useState=(...a)=>globalThis.__hooks.useState(...a);export const useRef=(...a)=>globalThis.__hooks.useRef(...a)", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== devices) return next(url, context);
    const source = readFileSync(new URL(url), "utf8");
    const start = source.lastIndexOf("  return (\n    <main>");
    if (start < 0) throw Error("Unexpected Devices render boundary");
    // Execute actual hook/effect/event logic before JSX. DOM/rendering is NOT
    // tested. No caller function body is copied or replaced by this harness.
    const logic = source.slice(0, start) + "  return {selectAccount,readCode,clearCodeRead,setCodeMode,setOperationId,account,codeMessage,codeLoading};\n}\n";
    return { format: "module", source: stripTypeScriptTypes(logic, { mode: "strip" }), shortCircuit: true };
  },
});
