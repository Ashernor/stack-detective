/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright must run in the Node.js runtime, not bundled. Keep it external.
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],

  // The file tracer can't see files these packages load via computed paths at
  // runtime (e.g. playwright-core/browsers.json, @sparticuz/chromium's brotli
  // binaries). Force the whole packages into the /api/analyze function bundle so
  // they exist on the serverless filesystem.
  outputFileTracingIncludes: {
    "/api/analyze": [
      "./node_modules/playwright-core/**",
      "./node_modules/@sparticuz/chromium/**",
    ],
  },
};

module.exports = nextConfig;
