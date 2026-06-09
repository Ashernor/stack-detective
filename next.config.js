/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright must run in the Node.js runtime, not bundled. Keep it external.
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
};

module.exports = nextConfig;
