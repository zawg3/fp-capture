# fp-capture

Static fingerprint collectors on GitHub Pages.

**Live:** https://zawg3.github.io/fp-capture/

| Page | URL | Purpose |
|------|-----|---------|
| Hub | `/` | Pick a collector |
| Laylo | `/fp/` | Laylo `b9()` canvas / WebGL / audio hashes |
| Sardine | `/sardine/` | TM Sardine OfflineAudioContext + WebGL image hash (for `probe_bank.json`) |

## Sardine collector

Runs the same probes as `Tmregister/scratch/sardine_probe_capture.html`:

- **audio** — `OfflineAudioContext` triangle oscillator + dynamics compressor (sum samples 4500–4999)
- **webglImageHash** — Sardine collector shader → `canvas.toDataURL("image/png")` → SHA-512 hex

Output includes a ready-to-merge **`probeBankSnippet`** for `sardine_profiles/probe_bank.json`.
Captures auto-post to the Discord webhook (same as Laylo) unless you override with `?webhook=`.

## Deploy

1. Repo **Settings → Pages → Source** = **GitHub Actions**
2. Actions → **Deploy Pages** → **Run workflow** (or push to `main`)

If the run sits on **Waiting**, open it → **Review deployments** → **Approve**.
