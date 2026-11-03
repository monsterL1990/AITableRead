import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Manuscripts live in data/ at runtime. Do not copy that directory into the image.
  outputFileTracingExcludes: {
    "/*": ["./data/**"],
  },
  // Dev server hostname is localhost; the desk is opened at 127.0.0.1.
  // Without this, Next blocks /_next/hmr and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
