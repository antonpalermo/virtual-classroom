# CLAUDE.md — lib-web-standards

`@capstone/standards` — HTTP status code/phrase constants, consumed via subpath exports:
- `@capstone/standards/status-codes` → `src/status-codes.ts`
- `@capstone/standards/status-phrases` → `src/status-phrases.ts`

Shareable across workspaces so every worker uses the same status codes and phrases instead of hardcoding them.

## Generated files — do not edit

Both files are **generated, do-not-edit** constant tables (~350 lines each, one JSDoc'd `export const` per status). They're small enough to read in full.

There is no `generate` script in this package's `package.json` — how these were originally produced isn't documented here. Treat them as committed, read-only output; if regeneration is ever needed, that process needs to be established first rather than hand-editing the files.

## Commands (run from this directory, or via `npm run <script> -w @capstone/standards` from root)

- `dev` — `tsc --watch`
- `build` — `tsc`
