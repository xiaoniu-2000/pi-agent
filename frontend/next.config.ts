import type { NextConfig } from "next";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath && configuredBasePath !== "/"
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "0.1.0",
    NEXT_PUBLIC_PI_VERSION: "0.84.2",
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
