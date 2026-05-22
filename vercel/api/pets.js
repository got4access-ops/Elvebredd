// Vercel Edge function that returns the elvebredd pet array as JSON.
//
// Strategy: try direct fetch (Vercel Edge's TLS sometimes passes CF). If CF
// challenges it, fall back to fetching the Wayback Machine archive — that
// always works because archive.org isn't behind Cloudflare.

export const config = { runtime: "edge" };

const DIRECT = "https://elvebredd.com/adopt-me-calculator";
const WAYBACK = "https://web.archive.org/web/2if_/https://elvebredd.com/adopt-me-calculator";

function isCFChallenge(text) {
    return text.includes("Just a moment")
        || text.includes("Attention Required")
        || text.includes("cf-browser-verification");
}

// If body is the raw RSC stream, it's already a single string. If it's the
// HTML page with __next_f.push chunks (which is what Wayback returns), stitch
// the chunks back together with JSON.parse to undo their string-escaping.
function maybeStitch(body) {
    if (!body.includes("__next_f")) return body;
    const out = [];
    let i = 0;
    const needle = "self.__next_f.push(";
    while (true) {
        const s = body.indexOf(needle, i);
        if (s < 0) break;
        let depth = 1, inStr = false, esc = false;
        let j = s + needle.length;
        while (j < body.length && depth > 0) {
            const c = body[j];
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') inStr = !inStr;
            else if (!inStr) {
                if (c === "(") depth++;
                else if (c === ")") depth--;
            }
            j++;
        }
        const inner = body.slice(s + needle.length, j - 1); // [N,"..."]
        try {
            const dec = JSON.parse(inner);
            if (typeof dec[1] === "string") out.push(dec[1]);
        } catch {}
        i = j;
    }
    return out.join("");
}

function extractPets(text) {
    const m = text.indexOf('"image":"/images/pets/');
    if (m < 0) throw new Error("marker not found");
    const start = text.lastIndexOf("[{", m);
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "[" || c === "{") depth++;
        else if (c === "]" || c === "}") {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    if (end < 0) throw new Error("array end not found");
    return JSON.parse(text.slice(start, end));
}

async function tryFetch(url, headers) {
    try {
        const r = await fetch(url, { headers });
        if (r.status !== 200) return { ok: false, reason: `status ${r.status}` };
        const text = await r.text();
        if (isCFChallenge(text)) return { ok: false, reason: "CF challenge" };
        if (text.length < 1000) return { ok: false, reason: "tiny body" };
        return { ok: true, text };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

export default async function handler(req) {
    const tried = [];

    // 1) Direct with RSC:1 — Vercel Edge fetch sometimes passes CF
    let r = await tryFetch(DIRECT, {
        "RSC": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    });
    tried.push({ source: "direct", ok: r.ok, reason: r.reason });

    // 2) Wayback fallback (always works, but stale)
    let source = "direct (live)";
    if (!r.ok) {
        source = "wayback (snapshot)";
        r = await tryFetch(WAYBACK, {
            "User-Agent": "Mozilla/5.0 (compatible; ElvebreddProxy/1.0)",
        });
        tried.push({ source: "wayback", ok: r.ok, reason: r.reason });
    }

    if (!r.ok) {
        return new Response(JSON.stringify({ error: "all sources failed", tried }), {
            status: 502, headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const stitched = maybeStitch(r.text);
        const pets = extractPets(stitched);
        return new Response(JSON.stringify(pets), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
                "X-Source": source,
                "X-Pet-Count": String(pets.length),
            },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message, source, tried }), {
            status: 500, headers: { "Content-Type": "application/json" },
        });
    }
}
