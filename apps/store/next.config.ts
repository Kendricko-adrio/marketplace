import type { NextConfig } from "next";
import { config } from "dotenv";

// Load shared root .env first, then app-local .env.local overrides.
config({ path: "../../.env" });
config({ path: ".env.local", override: true });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@marketplace/ui"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
