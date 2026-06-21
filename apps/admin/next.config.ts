import type { NextConfig } from "next";
import { config } from "dotenv";

// Load shared root .env first, then app-local .env.local overrides.
config({ path: "../../.env" });
config({ path: ".env.local", override: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@marketplace/ui"],
};

export default nextConfig;
