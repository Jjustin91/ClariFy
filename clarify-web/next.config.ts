import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  turbopack: {},
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'https://clarify-api.onrender.com/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;