# @capstone/ui

Shared UI library: [shadcn/ui](https://ui.shadcn.com) components on [Base UI](https://base-ui.com) with a Tailwind v4 theme. Shipped as raw source (no build step); consuming apps (`worker-client`, `worker-admin`, `worker-oidc`) bundle it with Vite.

- `@capstone/ui/globals.css` — Tailwind entry and theme tokens
- `@capstone/ui/components/<name>` — components
- `@capstone/ui/lib/utils` — `cn` helper

See [CLAUDE.md](CLAUDE.md) for how to add components.
