# Elvebredd Vercel Proxy

A Vercel serverless function that fetches Adopt Me pet values from elvebredd.com using a Chrome TLS fingerprint, then re-exposes them as plain JSON. Your Roblox executor can hit the Vercel URL without ever touching Cloudflare directly.

## How it works

`elvebredd.com` is on Cloudflare and blocks any TLS handshake that doesn't fingerprint as a real browser. Node's stock fetch (which Vercel uses) gets 403'd. This function uses [`cycletls`](https://www.npmjs.com/package/cycletls) — a Node wrapper around a Go TLS client that performs the handshake with Chrome's exact JA3 cipher list. CF sees what looks like Chrome and lets it through.

## Deploy

```sh
cd vercel
npm install
npx vercel        # follow prompts, choose free hobby plan
npx vercel deploy --prod
```

You'll get a URL like `https://elvebredd-proxy-xxxx.vercel.app`. Test it:

```sh
curl https://elvebredd-proxy-xxxx.vercel.app/api/pets | head -c 500
```

Should return a JSON array of ~3,300 pet objects.

## From Lua

Point your GUI script at the Vercel URL:

```lua
local PROXY = "https://elvebredd-proxy-xxxx.vercel.app/api/pets"
local res = request({ Url = PROXY, Method = "GET" })
local pets = game:GetService("HttpService"):JSONDecode(res.Body)
-- pets is a flat array; each entry has rvalue/nvalue/mvalue variants
```

The proxy caches in-memory for 1 hour. Hit `/api/pets?refresh=1` to bust the cache when values drift.

## Cost

- Vercel Hobby tier: free, 100k function invocations/month
- Cold start ~2s (cycletls spins up its Go subprocess), warm ~300ms
- Function size with cycletls: ~15 MB (well under Vercel's 50 MB limit)

## Caveats

- If elvebredd ramps up CF security (e.g. enables Turnstile challenge), cycletls's JA3 may need updating to a newer Chrome version
- The cycletls Go binary is Linux-only; works fine on Vercel since their runtime is Linux
