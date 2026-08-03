import type { NextConfig } from "next";

const allowedOrigins = process.env.DASHBOARD_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  transpilePackages: ["@cenblu/config", "@cenblu/database", "@cenblu/collector"],
  experimental: { serverActions: { bodySizeLimit: "11mb", ...(allowedOrigins?.length ? { allowedOrigins } : {}) } },
};

export default nextConfig;
