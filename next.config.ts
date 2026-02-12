import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // Silences the warning about multiple lockfiles and pins root to this folder
    turbopack: {
      root: '.'
    }
  } as any
};

export default nextConfig;
