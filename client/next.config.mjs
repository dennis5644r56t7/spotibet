/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self' 'unsafe-inline' 'unsafe-eval' http: https: ws: wss: data: blob:;",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co https://*.posthog.com *;",
              "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co https://*.posthog.com *;",
              "connect-src 'self' http://localhost:5000 ws://localhost:5000 wss://localhost:5000 https://eu-assets.i.posthog.com https://eu.i.posthog.com https://*.posthog.com https://*.paystack.co https: http: ws: wss: *;",
              "img-src 'self' data: blob: http: https: *;",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com *;",
              "font-src 'self' data: https://fonts.gstatic.com *;",
            ].join(' '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
