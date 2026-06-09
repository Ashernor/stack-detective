// Popup controller. Loaded as a classic script after signatures.js + detect.js,
// so window.STACK_SIGNATURES and window.detectStack are available.

const { SIGNATURES } = window.STACK_SIGNATURES;
const ALL_GLOBALS = Array.from(
  new Set(SIGNATURES.flatMap((s) => s.global || []))
);

const metaEl = document.getElementById("meta");
const resultsEl = document.getElementById("results");
const toolbarEl = document.getElementById("toolbar");

let lastResult = null;

// This function is serialized and injected into the page's MAIN world, so it can
// read window globals, resource-timing network requests, scripts, and cookies
// from the *real* page the user is viewing (their IP, fully rendered).
function gatherInPage(globalNames) {
  const scriptSrcs = Array.from(document.querySelectorAll("script[src]"))
    .map((s) => s.src)
    .filter(Boolean);

  // Network haystack from two sources: the Resource Timing API (what the page
  // actually fetched) plus every src/href in the DOM (catches vendor CDNs even
  // when the timing buffer overflowed or the element didn't generate an entry).
  const urls = new Set();
  try {
    for (const e of performance.getEntriesByType("resource")) urls.add(e.name);
  } catch (e) {
    /* ignore */
  }
  for (const el of document.querySelectorAll("[src],[href]")) {
    const u = el.src || el.href;
    if (typeof u === "string" && /^https?:/i.test(u)) urls.add(u);
  }
  const requestUrls = Array.from(urls);

  const globals = [];
  for (const n of globalNames) {
    try {
      if (typeof window[n] !== "undefined") globals.push(n);
    } catch (e) {
      /* cross-origin / restricted accessor */
    }
  }

  let cookies = [];
  try {
    cookies = document.cookie
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean);
  } catch (e) {
    /* ignore */
  }

  const html = document.documentElement
    ? document.documentElement.outerHTML.slice(0, 3000000)
    : "";

  return {
    requestUrls,
    scriptSrcs,
    html,
    globals,
    cookies,
    title: document.title,
    finalUrl: location.href,
  };
}

async function run() {
  resultsEl.innerHTML = '<div class="info">Scanning this page…</div>';
  metaEl.textContent = "";
  toolbarEl.hidden = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id || /^(chrome|edge|about|chrome-extension|https:\/\/chromewebstore)/.test(tab.url || "")) {
    resultsEl.innerHTML =
      '<div class="info">This page can\'t be analyzed (browser-internal or store page). Open a normal website and try again.</div>';
    return;
  }

  let evidence;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: gatherInPage,
      args: [ALL_GLOBALS],
    });
    evidence = injection.result;
  } catch (err) {
    resultsEl.innerHTML =
      '<div class="info">Couldn\'t read this page: ' +
      escapeHtml(err.message || String(err)) +
      "</div>";
    return;
  }

  const detections = window.detectStack(evidence);
  lastResult = {
    finalUrl: evidence.finalUrl,
    title: evidence.title,
    detections,
    stats: {
      requests: evidence.requestUrls.length,
      scripts: evidence.scriptSrcs.length,
      globals: evidence.globals.length,
    },
  };

  render(lastResult);
}

function render(result) {
  const host = hostnameFor(result);
  metaEl.innerHTML =
    `<b>${escapeHtml(result.title || host)}</b><span class="badge mode">live page</span><br>` +
    `${escapeHtml(result.finalUrl)}<br>` +
    `<b>${result.stats.requests}</b> requests · <b>${result.stats.scripts}</b> scripts · ` +
    `<b>${result.stats.globals}</b> globals`;

  toolbarEl.hidden = result.detections.length === 0;

  const mine = result.detections.filter((d) => d.self);
  const competitors = result.detections.filter((d) => d.competitor && !d.self);
  const others = result.detections.filter((d) => !d.competitor && !d.self);

  let html = "";
  if (result.detections.length === 0) {
    html =
      '<div class="empty">No known vendors detected on this page. Try navigating to a category or search results page, then re-scan.</div>';
  } else {
    if (mine.length)
      html += section(`Your stack — Attraqt (${mine.length})`, mine);
    if (competitors.length)
      html += section(`Competitor / discovery vendors (${competitors.length})`, competitors);
    if (others.length)
      html += section(`Other detected services (${others.length})`, others);
  }
  resultsEl.innerHTML = html;
}

function section(title, items) {
  return (
    `<div class="section-title">${escapeHtml(title)}</div>` +
    items.map(card).join("")
  );
}

function card(d) {
  const cls = d.self ? " self" : d.competitor ? " competitor" : "";
  const badges =
    (d.self ? '<span class="badge self">your product</span>' : "") +
    (d.competitor ? '<span class="badge comp">competitor</span>' : "") +
    `<span class="badge cat">${escapeHtml(d.category)}</span>` +
    `<span class="badge ${d.confidence}">${d.confidence}</span>`;
  const link = d.website
    ? `<a href="${escapeHtml(d.website)}" target="_blank" rel="noreferrer">site ↗</a>`
    : "";
  const ev = d.evidence
    .map(
      (e) =>
        `<li><span class="etype">${escapeHtml(e.type)}</span>${escapeHtml(e.detail)}</li>`
    )
    .join("");
  return (
    `<div class="card${cls}"><div class="card-head">` +
    `<span class="name">${escapeHtml(d.name)}</span>${badges}${link}` +
    `</div><ul class="evidence">${ev}</ul></div>`
  );
}

function hostnameFor(result) {
  try {
    return new URL(result.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    return "page";
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// ---- export ----
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

document.getElementById("rescan").addEventListener("click", run);
document.getElementById("exportJson").addEventListener("click", () => {
  if (!lastResult) return;
  download(
    `stack-detective-${hostnameFor(lastResult)}.json`,
    JSON.stringify(lastResult, null, 2),
    "application/json"
  );
});
document.getElementById("exportCsv").addEventListener("click", () => {
  if (!lastResult) return;
  const rows = [
    ["url", "vendor", "category", "competitor", "self", "confidence", "evidence_type", "evidence_detail"],
  ];
  for (const d of lastResult.detections) {
    for (const e of d.evidence) {
      rows.push([
        lastResult.finalUrl,
        d.name,
        d.category,
        d.competitor ? "yes" : "no",
        d.self ? "yes" : "no",
        d.confidence,
        e.type,
        e.detail,
      ]);
    }
  }
  download(
    `stack-detective-${hostnameFor(lastResult)}.csv`,
    rows.map((r) => r.map(csvCell).join(",")).join("\n"),
    "text/csv"
  );
});

run();
