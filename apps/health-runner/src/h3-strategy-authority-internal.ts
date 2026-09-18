import type { H3SurfaceStrategy } from "./h3-strategy.js";

const packagedStrategies = new WeakSet<object>();

export function markPackagedH3Strategy<T extends H3SurfaceStrategy>(
  strategy: T,
): T {
  packagedStrategies.add(strategy);
  return strategy;
}

export function isPackagedH3Strategy(strategy: H3SurfaceStrategy): boolean {
  return packagedStrategies.has(strategy);
}
