import type { NextConfig } from "next";

// GitHub Pages serves a project site under /<repo>; the workflow sets this.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const config: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default config;
