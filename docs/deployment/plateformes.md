# Déploiement multi-plateformes (Nitro)

Chaque application (`apps/*`) est construite par Nitro, qui détecte la plateforme
automatiquement ou suit `NITRO_PRESET`.

| Cible | Réglage | Sortie |
|---|---|---|
| Vercel | 1 projet par app, Root Directory `apps/<app>` (détection auto) | `.vercel/output` |
| Netlify | Base directory `apps/<app>`, build `pnpm build` (détection auto) | `.netlify` |
| Cloudflare | `NITRO_PRESET=cloudflare_module` (attention : `pg` exige Hyperdrive) | `.output` |
| Node / VPS | `NITRO_PRESET=node-server pnpm build` puis `node .output/server/index.mjs` | `.output` |
| Docker | `docker build --build-arg APP=<app> .` | image |

## Prérequis communs
- `DATABASE_URL` : PostgreSQL hébergé (Neon, Supabase…). En serverless, utiliser l'URL *poolée* ; la taille du pool est 1 par défaut sur Vercel/Netlify (`DATABASE_POOL_MAX` pour surcharger).
- `SESSION_SECRET`, `PUBLIC_URL`, `BETTER_AUTH_COOKIE_DOMAIN` : un domaine personnalisé est requis pour le SSO entre sous-domaines (`*.vercel.app` ne partage pas les cookies).
- `STORAGE_DRIVER=s3` sur les plateformes serverless (le disque y est éphémère).
- Migrations : `pnpm db:migrate` depuis une machine avec accès à la base.
