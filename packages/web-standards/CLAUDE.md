# CLAUDE.md — web-standards

`@capstone/standards` — HTTP status code/phrase constants, consumed via subpath exports:
- `@capstone/standards/status-codes` → `src/status-codes.ts`
- `@capstone/standards/status-phrases` → `src/status-phrases.ts`

## Generated files — do not Read in full

Both files are **generated, do-not-edit** constant tables (~17,800 and ~18,700 lines respectively). Reading either in full is blocked via a `.claude/settings.json` deny rule — `grep` for the specific status code/phrase you need instead (e.g. `grep -n '"NOT_FOUND"' src/status-codes.ts`).

There is no `generate` script in this package's `package.json` — how these were originally produced isn't documented here. Treat them as committed, read-only output; if regeneration is ever needed, that process needs to be established first rather than hand-editing the files.

## Commands (run from this directory, or via `npm run <script> -w @capstone/standards` from root)

- `dev` — `tsc --watch`
- `build` — `tsc`
