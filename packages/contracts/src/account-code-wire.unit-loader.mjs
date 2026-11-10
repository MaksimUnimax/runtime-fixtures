// Offline Node test resolution for ONLY the two new TypeScript modules.
// Node 24 strips types; this does not perform semantic TypeScript checking.
import { registerHooks } from "node:module";
const owned = new Map(
  ["account-code-acj1", "account-code-wire"].map((name) => [
    new URL("./" + name + ".js", import.meta.url).href,
    new URL("./" + name + ".ts", import.meta.url).href,
  ]),
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && specifier.startsWith(".")) {
      const replacement = owned.get(new URL(specifier, context.parentURL).href);
      if (replacement) return nextResolve(replacement, context);
    }
    return nextResolve(specifier, context);
  },
});
