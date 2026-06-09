"use client";

import { useState, useEffect } from "react";

// Customer list (name + domain to analyze).
const CUSTOMERS = [
  { name: "Asos", url: "asos.com" },
  { name: "Adidas", url: "adidas.com" },
  { name: "JD Sports", url: "jdsports.co.uk" },
  { name: "Kingfisher", url: "kingfisher.com" },
  { name: "PVH", url: "pvh.com" },
  { name: "ITX", url: "inditex.com" },
  { name: "Auchan", url: "auchan.fr" },
  { name: "Chanel", url: "chanel.com" },
  { name: "New Look", url: "newlook.com" },
  { name: "Hermes", url: "hermes.com" },
  { name: "Puma", url: "puma.com" },
  { name: "Selfridges", url: "selfridges.com" },
  { name: "Boulanger", url: "boulanger.com" },
  { name: "Norauto", url: "norauto.fr" },
  { name: "H&M (COS)", url: "cosstores.com" },
  { name: "River Island", url: "riverisland.com" },
  { name: "Burberry", url: "burberry.com" },
  { name: "BSH", url: "bsh-group.com" },
  { name: "AO.COM", url: "ao.com" },
  { name: "Swarovski", url: "swarovski.com" },
  { name: "Dr Martens", url: "drmartens.com" },
  { name: "La Fourchette", url: "thefork.com" },
  { name: "M&S", url: "marksandspencer.com" },
  { name: "DeBijenkorf", url: "debijenkorf.nl" },
  { name: "Gucci", url: "gucci.com" },
  { name: "Armani", url: "armani.com" },
];

// Random 5–8 from the list. Deterministic default for the initial (SSR) render
// to avoid a hydration mismatch; randomized client-side in an effect.
function sampleCustomers() {
  const count = 5 + Math.floor(Math.random() * 4); // 5..8
  return [...CUSTOMERS].sort(() => Math.random() - 0.5).slice(0, count);
}

function hostnameFor(result) {
  try {
    return new URL(result.finalUrl || result.url).hostname.replace(/^www\./, "");
  } catch {
    return "site";
  }
}

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

function exportJson(result) {
  download(
    `stack-detective-${hostnameFor(result)}.json`,
    JSON.stringify(result, null, 2),
    "application/json"
  );
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(result) {
  const rows = [
    ["url", "vendor", "category", "competitor", "confidence", "evidence_type", "evidence_detail"],
  ];
  for (const d of result.detections) {
    for (const e of d.evidence) {
      rows.push([
        result.finalUrl,
        d.name,
        d.category,
        d.competitor ? "yes" : "no",
        d.confidence,
        e.type,
        e.detail,
      ]);
    }
  }
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  download(`stack-detective-${hostnameFor(result)}.csv`, csv, "text/csv");
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [sample, setSample] = useState(() => CUSTOMERS.slice(0, 6));
  const [showAll, setShowAll] = useState(false);

  // Randomize the visible customers on the client (avoids SSR hydration drift).
  useEffect(() => {
    setSample(sampleCustomers());
  }, []);

  async function run(target) {
    const value = (target ?? url).trim();
    if (!value) return;
    setUrl(value);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        setResult(data);
      }
    } catch (e) {
      setError("Network error — is the server running?");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    run();
  }

  const mine = result?.detections.filter((d) => d.self) ?? [];
  const competitors =
    result?.detections.filter((d) => d.competitor && !d.self) ?? [];
  const others =
    result?.detections.filter((d) => !d.competitor && !d.self) ?? [];

  return (
    <div className="wrap">
      <div className="hero">
        <h1>
          Stack Detective<span className="dot">.</span>
        </h1>
        <p>
          Feed it a URL. It renders the page in a real browser and reports the
          search, discovery &amp; personalization vendors it&apos;s running —
          including competitors like Algolia, Constructor, Bloomreach and Coveo.
        </p>
      </div>

      <form className="search" onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <button className="go" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : null}
          {loading ? "Analyzing" : "Analyze"}
        </button>
      </form>

      <div className="examples">
        <span className="examples-label">
          {showAll ? "All customers:" : "Try a customer:"}
        </span>
        {(showAll ? CUSTOMERS : sample).map((c) => (
          <button key={c.name} onClick={() => run(c.url)} disabled={loading}>
            {c.name}
          </button>
        ))}
        <button
          className="examples-toggle"
          onClick={() => setShowAll((v) => !v)}
          disabled={loading}
        >
          {showAll ? "Show fewer" : "Show all customers →"}
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {result ? (
        <>
          <div className="meta">
            <span>
              <b>{result.title || "Untitled page"}</b>
            </span>
            <span>{result.finalUrl}</span>
            <span>
              HTTP <b>{result.status ?? "?"}</b>
            </span>
            <span>
              <b>{result.stats.requests}</b> requests ·{" "}
              <b>{result.stats.scripts}</b> scripts
            </span>
            <span className={"badge mode " + result.mode}>
              {result.mode === "rendered" ? "rendered (JS)" : "static HTML"}
            </span>
          </div>

          {result.detections.length > 0 ? (
            <div className="toolbar">
              <button onClick={() => exportJson(result)}>Export JSON</button>
              <button onClick={() => exportCsv(result)}>Export CSV</button>
            </div>
          ) : null}

          {result.warning ? (
            <div className="warning">{result.warning}</div>
          ) : null}

          {result.detections.length === 0 ? (
            <div className="empty">
              No known vendors detected. The site may use a custom/in-house
              stack, or — especially on a hosted deployment — its bot protection
              may be blocking the request. Check the HTTP status and the notice
              above.
            </div>
          ) : null}

          {mine.length > 0 ? (
            <>
              <div className="section-title">
                Your stack — Attraqt ({mine.length})
              </div>
              <div className="cards">
                {mine.map((d) => (
                  <DetectionCard key={d.id} d={d} />
                ))}
              </div>
            </>
          ) : null}

          {competitors.length > 0 ? (
            <>
              <div className="section-title">
                Competitor / discovery vendors ({competitors.length})
              </div>
              <div className="cards">
                {competitors.map((d) => (
                  <DetectionCard key={d.id} d={d} />
                ))}
              </div>
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              <div className="section-title">
                Other detected services ({others.length})
              </div>
              <div className="cards">
                {others.map((d) => (
                  <DetectionCard key={d.id} d={d} />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {!result && !loading && !error ? (
        <div className="empty">
          Results will show here. Detection runs server-side in a headless
          browser, so it catches scripts loaded dynamically — not just what&apos;s
          in the raw HTML.
        </div>
      ) : null}
    </div>
  );
}

function DetectionCard({ d }) {
  return (
    <div className={"card" + (d.self ? " self" : d.competitor ? " competitor" : "")}>
      <div className="card-head">
        <span className="name">{d.name}</span>
        {d.self ? <span className="badge self">your product</span> : null}
        {d.competitor ? <span className="badge comp">competitor</span> : null}
        <span className="badge cat">{d.category}</span>
        <span className={"badge " + d.confidence}>{d.confidence} confidence</span>
        {d.website ? (
          <a href={d.website} target="_blank" rel="noreferrer">
            site ↗
          </a>
        ) : null}
      </div>
      <ul className="evidence">
        {d.evidence.map((e, i) => (
          <li key={i}>
            <span className="etype">{e.type}</span>
            {e.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
