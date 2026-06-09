import { NextResponse } from "next/server";
import { analyzeUrl } from "../../../lib/analyze";

// Playwright needs the full Node.js runtime, and rendering can take a while.
export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeUrl(input) {
  let u = (input || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    // Block obvious SSRF targets (local / private network probing).
    const host = parsed.hostname.toLowerCase();
    const blocked =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (blocked) return { error: "Local/private addresses are not allowed." };
    return { url: parsed.toString() };
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const norm = normalizeUrl(body?.url);
  if (!norm) return NextResponse.json({ error: "Please provide a URL." }, { status: 400 });
  if (norm.error) return NextResponse.json({ error: norm.error }, { status: 400 });

  try {
    const result = await analyzeUrl(norm.url);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err && err.message ? err.message : "Failed to analyze that page.";
    return NextResponse.json(
      { error: message, url: norm.url },
      { status: 502 }
    );
  }
}
