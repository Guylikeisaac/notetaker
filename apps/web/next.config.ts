import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Locally, share the repo-root .env with the worker. On Vercel, env comes from project settings.
if (!process.env.VERCEL && existsSync("../../.env")) process.loadEnvFile("../../.env");

const nextConfig: NextConfig = {
  transpilePackages: ["@notetaker/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
