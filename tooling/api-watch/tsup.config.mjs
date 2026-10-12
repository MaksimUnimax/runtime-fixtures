// Keep the private workspace runtime dependency inside the Node.js bundle.
// It exports TypeScript sources, which bare Node cannot resolve after tsup.
export default {
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  noExternal: ["@product/monitoring-control"],
};
