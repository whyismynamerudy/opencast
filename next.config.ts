import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const headers = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];
    if (process.env.WEBMCP_ORIGIN_TRIAL_TOKEN) {
      headers.push({ key: "Origin-Trial", value: process.env.WEBMCP_ORIGIN_TRIAL_TOKEN });
    }
    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
};

export default nextConfig;
