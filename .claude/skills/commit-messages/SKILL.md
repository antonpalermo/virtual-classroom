---
name: commit-messages
description: Use when creating a git commit in this repository — defines the required Conventional Commits format, workspace scope, and bullet-point body style.
---

# Commit Messages

## Format

```
<type>(<scope>): <short imperative summary>

- <bullet describing one concrete change>
- <bullet describing another concrete change>
```

**Type** — one of the standard Conventional Commits types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`, `perf`, `build`, `ci`.

**Scope** — the short workspace directory name: `client`, `realtime`, `web-standards`, `config-typescript`. Never the full `@capstone/*` package name.

**Subject** — imperative mood ("add", not "added"/"adds"), short but informational (states what changed, not just "fix bug"), no trailing period.

**Body** — short bullet points (`- `), one line each, each describing one concrete change. Not prose paragraphs, not a restatement of the subject. Keep the whole body terse — a summary, not a changelog entry.

## Scope and multi-workspace changes

A commit's scope is always the single workspace it touches. When a change genuinely spans multiple workspaces (e.g. a file in `apps/worker-client` and a file in `apps/worker-realtime` in the same unit of work), **split it into separate commits, one per workspace, each with its own scope** — never one commit with no scope or a combined scope.

**No-scope commits** are reserved for changes that are inherently one indivisible unit spanning the whole repo and cannot be meaningfully split — e.g. editing root `CLAUDE.md`, `turbo.json`, `biome.json`, or root `package.json`. These use `<type>: <summary>` with no parenthesized scope.

## No AI traces

Never add a `Co-Authored-By: Claude` line, a "Generated with Claude Code" line, a session URL, or any other marker that the commit was authored by an AI assistant.

## Examples

```
feat(client): add screen-share toggle to room controls

- add ScreenShareButton component to room toolbar
- wire toggle state through useRoomControls hook
```

```
fix(realtime): prevent duplicate socket registration on reconnect

- guard Messenger.onConnect against re-registering an existing session id
```

```
docs: document branching strategy in CLAUDE.md
```

(root-level change touching only `CLAUDE.md` — no scope, since it's not workspace-specific)
