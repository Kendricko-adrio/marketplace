import type { NextConfig } from "next";
import { config } from "dotenv";

// Load shared root .env first, then app-local .env.local overrides.
config({ path: "../../.env" });
config({ path: ".env.local", override: true });

const storeUrl = process.env.NEXT_PUBLIC_STORE_URL || "http://localhost:3000";
let storeHost = "";
try {
  storeHost = new URL(storeUrl).hostname;
} catch {
  storeHost = "localhost";
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@marketplace/ui"],
  images: {
    remotePatterns: [
      { protocol: "http", hostname: storeHost },
      { protocol: "https", hostname: storeHost },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
