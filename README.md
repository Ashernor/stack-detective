# Stack Detective

Feed it a URL. It renders the page in a real headless browser (Playwright +
Chromium) and reports the **search / discovery / personalization vendors** the
site is running — flagging competitors like Algolia, Constructor, Bloomreach,
Coveo, Searchspring, Klevu, Nosto, Dynamic Yield and more.

Because detection runs server-side in a rendered browser, it catches scripts
loaded dynamically (via tag managers, async loaders, etc.) — not just what's in
the raw HTML.

## How it works

1. `POST /api/analyze` with `{ "url": "example.com" }`.
2. The server (`lib/analyze.js`) launches headless Chromium, navigates, waits
   for network idle, then collects evidence: every network request, every
   `<script src>`, the rendered HTML, which probed `window.*` globals exist, and
   cookie names.
3. That evidence is matched against the signature database in
   `lib/signatures.js`. Each detection reports its **evidence** (network URL /
   global var / HTML match) and a **confidence** level (network/global = high,
   HTML-only = low).
4. The UI (`app/page.js`) groups competitors first, then other services.

## Adding a vendor

Add an entry to `SIGNATURES` in `lib/signatures.js`:

```js
{
  id: "vendor",
  name: "Vendor Name",
  category: CAT.SEARCH,
  competitor: true,
  website: "https://vendor.com",
  url: [/vendor\.com/i],        // tested vs network requests + script srcs
  global: ["VendorSDK"],         // window.* property names
  html: [/vendor/i],             // weak signal — low confidence on its own
}
```

## Running

> **Node 20+ required** (Next.js 16 + Playwright). On this machine the default
> `node` on PATH is v16 via nvm, so the dev server is pinned to Homebrew's node.

```bash
# install deps + browser (once)
/opt/homebrew/bin/npm install
/opt/homebrew/bin/npx playwright install chromium

# dev server
/opt/homebrew/bin/node node_modules/next/dist/bin/next dev
# -> http://localhost:3000
```

Or with a modern node already on PATH: `npm run dev`.

## Exporting results

Once a page is analyzed, **Export JSON** gives the full structured result
(including all evidence), and **Export CSV** gives one row per piece of evidence
— handy for dropping into a spreadsheet / CRM for prospecting.

## Deploying to Netlify

Headless browsers don't run in standard serverless functions, so the app uses a
two-tier strategy:

- **Local / long-running server:** full `playwright` + bundled Chromium →
  `mode: "rendered"` (sees `window.*` globals and dynamically-injected scripts).
- **Serverless (Netlify/Vercel/Lambda):** `playwright-core` driving
  [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium), a
  Lambda-compatible Chromium build. The environment is detected automatically
  via `NETLIFY` / `VERCEL` / `AWS_*` env vars.
- **Fallback:** if the browser can't launch (cold start, size, timeout), the
  analyzer falls back to a plain HTTP fetch → `mode: "html"`, and the UI shows a
  notice. It still detects any vendor whose loader appears in the served HTML.

`netlify.toml` bundles the Chromium binary into the function via
`included_files`. The `@netlify/plugin-nextjs` runtime is auto-installed.

> **Timeout caveat:** rendering can take several seconds, and Netlify's default
> function timeout is 10s. If you see frequent `mode: "html"` fallbacks or
> timeouts, raise the function timeout (Netlify dashboard → site config →
> Functions; extended timeouts up to 26s require an eligible plan). The route
> already declares `maxDuration = 60`. As long as the timeout holds, you get
> rendered results; otherwise the HTTP fallback keeps the app working.

## Notes / limits

- Sites with aggressive bot protection (Akamai, Cloudflare bot management) may
  return a 403 / "Access Denied" to the headless browser. That's a detection
  limitation, not a bug — the status code is shown in the results header.
- Private/local addresses are blocked in the API route to avoid SSRF.
