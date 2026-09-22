import type { NextConfig } from 'next';

/**
 * Security headers are applied to every route. The CSP allows only same-origin
 * resources (no external scripts, fonts or images are used by the app).
 */
const isDev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // SQL migrations are read at runtime by the auto-migrator
  outputFileTracingIncludes: { '/**': ['./supabase/migrations/*.sql'] },
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'pg-connection-string', 'pg-native'],
  // Instrumentation is bundled by Next's server webpack path. Force the Node-only
  // database drivers to remain runtime externals there as well; otherwise webpack
  // walks pg's optional/Node built-in dependencies (fs/path) during dev.
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = [
        ...(config.externals ?? []),
        { pg: 'commonjs pg' },
        { 'pg-native': 'commonjs pg-native' },
        { '@electric-sql/pglite': 'commonjs @electric-sql/pglite' },
      ];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
