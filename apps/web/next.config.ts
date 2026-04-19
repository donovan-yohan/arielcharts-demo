import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@arielcharts/shared'],
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
