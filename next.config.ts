import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        port: '',
        pathname: '/t/p/**',
      },
    ],
  },
  async rewrites() {
    // Read the worker URL from the environment, fallback to localhost for dev
    const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8787";
    
    return [
      {
        source: '/api/:path*',
        destination: `${workerUrl}/api/:path*`, 
      },
    ];
  },
};

export default nextConfig;