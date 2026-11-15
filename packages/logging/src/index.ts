// Relative re-exports use the explicit `.js` extension: this package is ESM
// (`"type": "module"`), and Node requires the emitted specifier to be fully
// resolved. TypeScript maps `./logger.js` to `./logger.ts` at compile time
// (`moduleResolution: "Bundler"`), so the source stays extension-correct while
// `dist/index.js` / `dist/index.d.ts` get a Node-resolvable specifier.
export { createLogging } from "./logger.js";
export type {
  LogDestination,
  Logging,
  LoggingOptions,
  LogLevel,
  ModuleLogger,
} from "./logger.js";
