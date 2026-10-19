# Public site: jmwifi.pro (active) · jmestre.tech → jmwifi.pro

## Goal
- **jmwifi.pro** = active public billing / landing
- **jmestre.tech** = redirect to `https://jmwifi.pro`

## Hostinger (live)
- Serves landing + billing on `jmwifi.pro`
- If Host header is `jmestre.tech`, nginx returns `301 https://jmwifi.pro$request_uri`
- `PUBLIC_URL=https://jmwifi.pro`

## Make jmestre.tech redirect while CORE WAN is down
`jmestre.tech` DNS currently points at CORE `112.208.245.181` (unreachable).

In Hostinger hPanel → Domains → **jmestre.tech** → DNS:
1. Set A `@` → `187.77.145.131`
2. Wait for propagation
3. `curl -sI https://jmestre.tech/` → `Location: https://jmwifi.pro/`

When CORE/jmvps is reachable again, nginx on jmvps can also `return 301 https://jmwifi.pro` for `jmestre.tech` if DNS stays on CORE.
