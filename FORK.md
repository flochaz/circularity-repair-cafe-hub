# Fork notes — `flochaz/circularity-repair-cafe-hub`

A fork of [Zesty0wl/circularity-repair-cafe-hub](https://github.com/Zesty0wl/circularity-repair-cafe-hub) (MIT),
run for the Repair Café of Villeneuve-Loubet (ECVL).

## Remotes

- `origin` — this fork: <https://github.com/flochaz/circularity-repair-cafe-hub>
- `upstream` — the original: <https://github.com/Zesty0wl/circularity-repair-cafe-hub>

## Changes from upstream

- `.github/workflows/deploy.yml` — deploy to Cloudflare Workers on push to `main`.

## Planned (see the ECVL planning docs)

Kept **additive** so we can keep pulling upstream releases:

- Staff-driven check-in as the default (the visitor never needs a phone).
- Low-friction volunteer sign-in (shared station device, no per-volunteer account).
- Session **card numbers** on the ticket (reusable 1–N deck, partial unique index).
- Weight at check-in; first-visit flag; exit satisfaction.
- ORDS export for the Open Repair Alliance.
