# Commit Message Skill Design

## Context

This is a Turborepo monorepo (`virtual-classroom`) with four workspaces: `apps/worker-client`, `apps/worker-realtime`, `packages/web-standards`, `packages/config-typescript`. The root `CLAUDE.md` previously carried an informal instruction about not leaving AI traces in commits, but no formal, structured commit message convention exists anywhere in the repo, and nothing enforces the convention Claude follows when asked to commit.

The user wants a Conventional Commits-based convention, scoped by workspace, with a short informational subject and a terse bullet-point body — captured as a Claude Code skill so it applies automatically whenever Claude is about to create a commit in this repo, rather than relying on it being manually invoked or remembered.

## Goals

- Define a concrete, unambiguous commit message convention: format, scope rules, subject style, body style, and the no-AI-traces rule.
- Package it as a project-level Claude Code skill (`.claude/skills/commit-messages/SKILL.md`), committed to git, so the convention also governs any future collaborator's commits (via Claude) and isn't tied to this user's personal config.
- Make the skill auto-trigger whenever Claude is about to create a git commit in this repo, via its `description` frontmatter, per the `using-superpowers` mechanism already in use by other skills in this environment.

## Non-goals

- Enforcement via a git hook (e.g. `commitlint` in `.husky/commit-msg`) — this skill governs Claude's behavior when it authors commits, not a hard gate on all commits regardless of author. Could be layered on later if desired.
- A skill for PR titles/descriptions — out of scope, commit messages only.
- Retroactively rewriting existing commit history to match this convention.

## Design

### Location and trigger

New skill at `.claude/skills/commit-messages/SKILL.md`, project-level (not personal `~/.claude/skills/`), so it's version-controlled and applies to anyone using Claude Code in this repo. Frontmatter:

```yaml
---
name: commit-messages
description: Use when creating a git commit in this repository — defines the required Conventional Commits format, workspace scope, and bullet-point body style.
---
```

The description is written to match the trigger pattern the `using-superpowers` skill already expects — "Use when X" — so it's picked up automatically the same way `brainstorming` or `systematic-debugging` are, with no need to invoke it by name.

### Commit message format

```
<type>(<scope>): <short imperative summary>

- <bullet describing one concrete change>
- <bullet describing another concrete change>
```

**Type** — standard Conventional Commits types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`, `perf`, `build`, `ci`.

**Scope** — the short workspace directory name: `client`, `realtime`, `web-standards`, `config-typescript`.

**Subject** — imperative mood ("add", not "added"/"adds"), short but informational (states what changed, not just "fix bug"), no trailing period.

**Body** — short bullet points (`- `), one line each, each describing one concrete change. Not prose paragraphs, not a restatement of the subject. Keep the whole body terse — this is a summary, not a changelog entry.

**No AI traces** — no `Co-Authored-By: Claude` line, no "Generated with Claude Code" line, no session URL, no other marker that the commit was authored by an AI assistant.

### Scope and multi-workspace changes

A commit's scope is always the single workspace it touches. When a change genuinely spans multiple workspaces (e.g. a file in `apps/worker-client` and a file in `apps/worker-realtime` in the same unit of work), **split it into separate commits, one per workspace, each with its own scope** — rather than one commit with no scope or a combined scope.

**No-scope commits** are reserved for changes that are inherently one indivisible unit spanning the whole repo and cannot be meaningfully split — e.g. editing root `CLAUDE.md`, `turbo.json`, `biome.json`, or root `package.json`. These use `<type>: <summary>` with no parenthesized scope.

### Examples

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

## Testing / verification

This is a documentation/skill-authoring change, not application code. Verification is: the skill file exists at the correct path with valid frontmatter, its content matches this spec's format/scope/body/no-AI-traces rules, and — since this skill is meant to auto-trigger and shape Claude's own behavior — a short in-session check that Claude actually follows it when asked to make a commit after the skill is in place.
