const { SIGNATURES } = require("./signatures");

// Collect every window property name a signature might look for, so we can probe
// them all in a single in-page evaluation.
const ALL_GLOBALS = Array.from(
  new Set(SIGNATURES.flatMap((s) => s.global || []))
);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Are we running in a serverless / Lambda-style environment (Netlify, Vercel,
// AWS)? There we must use a Lambda-compatible Chromium build instead of the
// bundled Playwright browser, which isn't present.
const IS_SERVERLESS = !!(
  process.env.NETLIFY ||
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.AWS_EXECUTION_ENV
);

// ---------------------------------------------------------------------------
// Strategy 1: full render in a headless browser (best signal — sees globals and
// dynamically injected scripts).
// ---------------------------------------------------------------------------
async function launchBrowser() {
  if (IS_SERVERLESS) {
    // @sparticuz/chromium ships a Chromium build that runs on AWS Lambda; pair
    // it with playwright-core (no bundled browser download). It's an ES module,
    // so load it with dynamic import() to stay compatible across Node versions.
    const mod = await import("@sparticuz/chromium");
    const sparticuz = mod.default || mod;
    const { chromium } = require("playwright-core");
    sparticuz.setGraphicsMode = false; // text scraping only — save resources
    const executablePath = await sparticuz.executablePath();
    return chromium.launch({
      args: sparticuz.args,
      executablePath,
      headless: true,
    });
  }
  // Local / long-running server: use the full Playwright package.
  const { chromium } = require("playwright");
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function gatherViaBrowser(url, opts = {}) {
  // Serverless functions have a hard wall-clock limit (≈10s on Netlify), so we
  // keep navigation and settle times tight there.
  const timeoutMs = opts.timeoutMs ?? (IS_SERVERLESS ? 8000 : 25000);
  const browser = await launchBrowser();
  const requestUrls = new Set();

  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    page.on("request", (req) => requestUrls.add(req.url()));

    // On serverless, abort heavy resources (images/media/fonts/css). The
    // 'request' event above still fires first, so we keep every URL for vendor
    // detection — we just don't download the bytes. This sharply cuts memory and
    // time, which is what was crashing the browser on big retail pages.
    if (IS_SERVERLESS) {
      await context.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "image" || type === "media" || type === "font" || type === "stylesheet") {
          return route.abort();
        }
        return route.continue();
      });
    }

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // Give late-loading tags (tag managers, async vendor scripts) a moment.
    // Kept short so we stay inside serverless function time limits.
    await page
      .waitForLoadState("networkidle", { timeout: IS_SERVERLESS ? 2500 : 5000 })
      .catch(() => {});
    await page.waitForTimeout(IS_SERVERLESS ? 600 : 1500);

    const html = await page.content();
    const title = await page.title().catch(() => "");
    const finalUrl = page.url();

    const scriptSrcs = await page.$$eval("script[src]", (els) =>
      els.map((e) => e.getAttribute("src")).filter(Boolean)
    );

    const globals = await page.evaluate((names) => {
      const out = [];
      for (const n of names) {
        try {
          if (typeof window[n] !== "undefined") out.push(n);
        } catch (_) {
          /* cross-origin access error — ignore */
        }
      }
      return out;
    }, ALL_GLOBALS);

    const cookies = (await context.cookies().catch(() => [])).map((c) => c.name);

    return {
      mode: "rendered",
      requestUrls: Array.from(requestUrls),
      scriptSrcs,
      html,
      globals,
      cookies,
      title,
      finalUrl,
      status: response ? response.status() : null,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: plain HTTP fetch (no JS execution). Works everywhere, always.
// Misses window globals and dynamically-injected scripts, but catches any
// vendor whose loader is referenced in the served HTML.
// ---------------------------------------------------------------------------
function extractUrls(html, baseUrl) {
  const urls = new Set();
  const re = /\b(?:src|href|data-src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:")) continue;
    try {
      urls.add(new URL(raw, baseUrl).toString());
    } catch {
      urls.add(raw);
    }
  }
  return Array.from(urls);
}

function extractScriptSrcs(html, baseUrl) {
  const srcs = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      srcs.push(new URL(m[1].trim(), baseUrl).toString());
    } catch {
      srcs.push(m[1].trim());
    }
  }
  return srcs;
}

async function gatherViaFetch(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();
    const finalUrl = res.url || url;
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const setCookie = res.headers.get("set-cookie") || "";
    const cookies = setCookie
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean);

    return {
      mode: "html",
      requestUrls: extractUrls(html, finalUrl),
      scriptSrcs: extractScriptSrcs(html, finalUrl),
      html,
      globals: [],
      cookies,
      title: titleMatch ? titleMatch[1].trim().slice(0, 200) : "",
      finalUrl,
      status: res.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Matching: run collected evidence against the signature database.
// ---------------------------------------------------------------------------
function detect(evidence) {
  const urlHaystack = [...evidence.requestUrls, ...evidence.scriptSrcs];
  const results = [];

  for (const sig of SIGNATURES) {
    const matches = [];

    if (sig.url) {
      for (const re of sig.url) {
        const hit = urlHaystack.find((u) => re.test(u));
        if (hit) {
          matches.push({ type: "network", detail: hit });
          break;
        }
      }
    }

    if (sig.global) {
      for (const g of sig.global) {
        if (evidence.globals.includes(g)) {
          matches.push({ type: "global", detail: `window.${g}` });
        }
      }
    }

    if (sig.cookie) {
      for (const re of sig.cookie) {
        const hit = evidence.cookies.find((c) => re.test(c));
        if (hit) {
          matches.push({ type: "cookie", detail: hit });
          break;
        }
      }
    }

    // HTML is the weakest signal (false positives from copy/mentions), so it
    // only ever yields "low" confidence on its own.
    if (sig.html) {
      for (const re of sig.html) {
        if (re.test(evidence.html)) {
          const m = evidence.html.match(re);
          matches.push({
            type: "html",
            detail: m ? m[0].slice(0, 80) : re.source,
          });
          break;
        }
      }
    }

    if (matches.length === 0) continue;

    const hasStrong = matches.some(
      (m) => m.type === "network" || m.type === "global" || m.type === "cookie"
    );

    results.push({
      id: sig.id,
      name: sig.name,
      category: sig.category,
      competitor: !!sig.competitor,
      self: !!sig.self,
      website: sig.website,
      confidence: hasStrong ? "high" : "low",
      evidence: matches,
    });
  }

  const rank = (d) => (d.self ? 0 : d.competitor ? 1 : 2);
  results.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

async function analyzeUrl(url, opts) {
  let evidence;
  let warning = null;
  let browserError = null;

  try {
    evidence = await gatherViaBrowser(url, opts);
  } catch (err) {
    // Browser unavailable or timed out (common on constrained serverless
    // runtimes) — fall back to a plain HTTP fetch so we still return something.
    browserError = (err && err.message ? err.message : String(err)).slice(0, 300);
    warning =
      "Rendered-browser analysis was unavailable; fell back to static HTML " +
      "(window globals and dynamically-injected scripts may be missed). " +
      "Reason: " +
      browserError;
    evidence = await gatherViaFetch(url, opts);
  }

  // A headless browser is more bot-detectable than a plain request. If the
  // rendered page was blocked (4xx/5xx), a plain HTTP fetch sometimes gets a
  // real page (this is what rescues e.g. puma.com), so try it and keep the
  // better result.
  if (evidence.mode === "rendered" && evidence.status && evidence.status >= 400) {
    try {
      const alt = await gatherViaFetch(url, opts);
      if (alt.status && alt.status < evidence.status) {
        warning =
          `The rendered request was blocked (HTTP ${evidence.status}); used a ` +
          `plain HTTP fetch instead (got HTTP ${alt.status}).`;
        evidence = alt;
      }
    } catch {
      /* keep the rendered (blocked) result */
    }
  }

  const detections = detect(evidence);

  // Page came back blocked (4xx/5xx) and nothing matched — explain why.
  if (!warning && detections.length === 0 && evidence.status && evidence.status >= 400) {
    warning =
      `The site responded with HTTP ${evidence.status} — it likely blocked the ` +
      `request. Retail sites behind Akamai/Cloudflare commonly block datacenter ` +
      `(serverless) IPs, so this can fail when deployed even though it works locally.`;
  }

  return {
    url,
    mode: evidence.mode,
    serverless: IS_SERVERLESS,
    warning,
    browserError,
    finalUrl: evidence.finalUrl,
    title: evidence.title,
    status: evidence.status,
    detections,
    stats: {
      requests: evidence.requestUrls.length,
      scripts: evidence.scriptSrcs.length,
      globals: evidence.globals.length,
    },
  };
}

module.exports = { analyzeUrl, gatherViaBrowser, gatherViaFetch, detect };
