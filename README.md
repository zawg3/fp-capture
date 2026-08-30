# fp-capture

Static fingerprint collectors on GitHub Pages.

**Live:** https://zawg3.github.io/fp-capture/

| Page | URL | Purpose |
|------|-----|---------|
| Hub | `/` | Pick a collector |
| Laylo | `/fp/` | Laylo `b9()` canvas / WebGL / audio hashes |
| Sardine | `/sardine/` | Full live-harbor collector (~179 fields) for `probe_bank.json` |

## Sardine collector

Loads Ticketmaster's real Sardine SDK from `api.live-harbor.com`:

- **`loader.min.d6170a0.js`** → `createContext` → full browser fingerprint bundle
- Intercepts `POST /v1/events` locally (gzip + index-XOR decode) — **nothing sent to Sardine**
- Output: full `eventsObject`, flat `payloadMap`, and **`probeBankSnippet`** for merge

Share: `https://zawg3.github.io/fp-capture/sardine/` — one capture per machine/GPU (Chrome/Edge desktop).

## Deploy

1. Repo **Settings → Pages → Source** = **GitHub Actions**
2. Actions → **Deploy Pages** → **Run workflow** (or push to `main`)

If the run sits on **Waiting**, open it → **Review deployments** → **Approve**.
