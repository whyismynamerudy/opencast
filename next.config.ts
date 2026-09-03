import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Do not force cross-origin isolation here. The app uses the regular
    // single-threaded ffmpeg core, and COOP/COEP can stop embedded browsers
    // (including ChatGPT Desktop's site-tools browser) from loading the page.
    const headers: { key: string; value: string }[] = [];
    if (process.env.WEBMCP_ORIGIN_TRIAL_TOKEN) {
      headers.push({ key: "Origin-Trial", value: process.env.WEBMCP_ORIGIN_TRIAL_TOKEN });
    }
    if (!headers.length) return [];
    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
};

export default nextConfig;
