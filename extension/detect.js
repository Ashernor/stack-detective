// Detection matcher for the extension. Mirrors lib/analyze.js `detect()`.
// Loaded as a classic <script>; reads window.STACK_SIGNATURES and exposes
// window.detectStack(evidence).
(function () {
  const { SIGNATURES } = window.STACK_SIGNATURES;

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

  window.detectStack = detect;
})();
