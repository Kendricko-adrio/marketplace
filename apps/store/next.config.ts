import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { config } from "dotenv";

export default function nextConfig(phase: string): NextConfig {
  // Load shared root .env first, then app-local .env.local overrides. Derive
  // NODE_ENV from Next's phase afterwards: dotenv must never turn `next dev`
  // into a live-write production runtime.
  config({ path: "../../.env" });
  // Isolated E2E runs supply loopback URLs; app-local defaults must not stomp them.
  config({ path: ".env.local", override: process.env.E2E_PROVIDER_MOCKS !== "true" });
  Reflect.set(
    process.env,
    "NODE_ENV",
    phase === PHASE_DEVELOPMENT_SERVER ? "development" : "production"
  );

  return {
    output: "standalone",
    transpilePackages: ["@marketplace/ui"],
    images: {
      unoptimized: true,
    },
  };
}
