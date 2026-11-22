# KYROX marketing site

Independent, fully static public website. It deliberately has no dependency on
`@kyrox/*` packages, the consumer dashboard, API routes, databases, RPC
endpoints, wallets, or any runtime secret.

## Build

```bash
pnpm --filter @kyrox/marketing build
```

The site is emitted as plain HTML/CSS/JS into `apps/marketing/out/` using
Next.js `output: "export"`. `pnpm --filter @kyrox/marketing typecheck` runs the
TypeScript check. No environment variables are required.

## Validation

Serve the export locally, then run the Playwright checks:

```bash
python3 -m http.server 4173 --directory apps/marketing/out
node apps/marketing/scripts/validate.mjs http://127.0.0.1:4173
```

The script checks all six target viewport widths, overflow, navigation, CTAs,
metadata, keyboard behavior, reduced motion, contrast, console/network errors,
and writes screenshots plus `validation-results.txt` outside the repository.

## Deployment

Deploy this app as a **separate** Vercel project whose root directory is
`apps/marketing`. `vercel.json` pins the build command and `out/` directory.
Never deploy `apps/web` as the public marketing site, never copy the consumer
app's environment variables, and use preview deployments only until a founder
approves production hosting.

No sitemap is generated yet because there is no confirmed public production
origin; `robots.txt` is emitted by `app/robots.ts`.
