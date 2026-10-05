# CLAUDE.md — lib-ui

`@capstone/ui` — the shared [shadcn/ui](https://ui.shadcn.com) component library, built on [Base UI](https://base-ui.com) (`@base-ui/react`, not Radix). Initialized from shadcn preset `b1Z5bafVC` (style `base-vega`, Tailwind v4, Lucide icons, Inter font). Shipped as raw source, no build step: consuming apps bundle it with Vite.

- `src/styles/globals.css` — Tailwind entry + theme tokens (`:root` / `.dark`). Exported as `@capstone/ui/globals.css`.
- `src/components/*.tsx` — shadcn components, exported as `@capstone/ui/components/<name>`.
- `src/lib/utils.ts` — `cn`, exported as `@capstone/ui/lib/utils`.

## Adding components

Run the shadcn CLI **from this directory** (it reads `components.json` here):

```sh
npx shadcn add dialog
```

Never add components inside an app — put them here so every app shares them.

## Using it in an app

`worker-client`, `worker-admin`, and `worker-oidc` are already wired: `@tailwindcss/vite` in `vite.config.ts`, `import '@capstone/ui/globals.css'` in `src/main.tsx`. Then:

```tsx
import { Button } from '@capstone/ui/components/button'
```

Tailwind scans the app's own files automatically (Vite root) and this package via `@source` in `globals.css`.

## Commands (run from this directory, or via `npm run <script> -w @capstone/ui` from root)

- `lint` — `biome check .`
- `check-types` — `tsc --noEmit`
