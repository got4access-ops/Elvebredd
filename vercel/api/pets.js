// Vercel serverless function that proxies elvebredd's pet values past Cloudflare.
//
// CF blocks Node's default TLS fingerprint, so we use cycletls — a Node wrapper
// around a Go binary that performs the TLS handshake with Chrome's JA3/JA4
// fingerprint. CF sees a "real Chrome" connection and lets it through.
//
// Endpoint:
//   GET /api/pets                → JSON pet array (cached 1h)
//   GET /api/pets?refresh=1      → bust cache, refetch
//
// Deploy:
//   1. `npm install cycletls` in this folder
//   2. `vercel deploy` (free tier is fine)
//   3. Roblox executor hits https://<your-project>.vercel.app/api/pets

import initCycleTLS from "cycletls";

let cache = { ts: 0, body: null };
const TTL_MS = 60 * 60 * 1000; // 1 hour

function extractPets(text) {
    const marker = text.indexOf('"image":"/images/pets/');
    if (marker < 0) throw new Error("marker not found");
    const start = text.lastIndexOf("[{", marker);
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

export default async function handler(req, res) {
    const force = req.query.refresh === "1";
    if (!force && cache.body && Date.now() - cache.ts < TTL_MS) {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Cache", "hit");
        return res.status(200).send(cache.body);
    }

    let cycleTLS;
    try {
        cycleTLS = await initCycleTLS();
        const r = await cycleTLS("https://elvebredd.com/adopt-me-calculator", {
            ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            headers: {
                "RSC": "1",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
            },
        }, "get");

        if (r.status !== 200) throw new Error(`upstream ${r.status}`);
        const pets = extractPets(r.body);
        cache = { ts: Date.now(), body: JSON.stringify(pets) };

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Cache", "miss");
        res.setHeader("X-Pet-Count", String(pets.length));
        return res.status(200).send(cache.body);
    } catch (err) {
        return res.status(500).json({ error: String(err.message || err) });
    } finally {
        if (cycleTLS) cycleTLS.exit();
    }
}
