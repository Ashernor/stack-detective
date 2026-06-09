# Stack Detective — Chrome Extension

Detects search / discovery / personalization vendors (Algolia, Constructor,
Bloomreach, Coveo, Nosto, Dynamic Yield…) on **the page you're currently
viewing**, and flags where **Attraqt** is running.

## Why an extension (vs. the web app)

It runs in your own browser, on your own connection:

- **Your residential IP** — sidesteps the datacenter-IP bot blocking (Akamai /
  Cloudflare) that made the hosted web app fail on retail sites like Harvey
  Nichols and ASOS.
- **Reads the real, rendered page** — actual DOM, network requests (Resource
  Timing), `src`/`href` URLs, and `window` globals — so it sees dynamically
  loaded vendor scripts.
- **Same signature database** as the web app (`signatures.js` is the shared
  file from `../lib/signatures.js`).

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or Edge: `edge://extensions`).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin "Stack Detective" to the toolbar (optional).

## Use

1. Navigate to any site (e.g. a prospect's storefront, a category page, or a
   search-results page — those load the search vendor).
2. Click the **Stack Detective** toolbar icon.
3. Results group into **Your stack (Attraqt)**, **Competitors**, and **Other
   services**, each with the matched evidence (network / global / cookie / html)
   and a confidence level.
4. Use **Export JSON / CSV**, or **↻** to re-scan after navigating.

## How it works

- `popup.js` injects a small gather function into the page's MAIN world via
  `chrome.scripting.executeScript`, collecting evidence from the live page.
- `detect.js` matches that evidence against `signatures.js`.
- Permissions are minimal: `activeTab` + `scripting` (access is granted only to
  the tab you're on, only when you click the icon). No host permissions, no
  background tracking.

## Notes

- Tip: vendor search scripts often load on **category / search pages** rather
  than the homepage — scan there for the fullest picture.
- `signatures.js` here is a copy of `../lib/signatures.js`. If you update vendor
  signatures, copy the file across (`cp ../lib/signatures.js signatures.js`) so
  the web app and extension stay in sync.
- No icon is bundled, so Chrome shows a default icon — drop `icon16/48/128.png`
  in this folder and add an `"icons"` block to `manifest.json` to brand it.
