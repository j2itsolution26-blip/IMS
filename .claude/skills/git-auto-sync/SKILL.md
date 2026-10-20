---
name: git-auto-sync
description: Automatically review, commit, and push completed coding changes to the configured GitHub upstream, with verification and safety checks.
---

# Git Auto-Sync

Use this after a coding task that modified project files is complete, and its
checks have run. It turns the finished work into one reviewed commit on the
current branch and pushes it to that branch's configured upstream on GitHub.

**Skip it entirely** when the task changed no project files (analysis, plans,
investigations, answers), or the user asked to keep the work local. Never
make an empty commit.

## The workflow

### 1. Review the changes

```bash
git status --short
git diff                 # unstaged
git diff --staged        # anything already staged — find out who staged it
```

Read the diff. Do not commit what you have not looked at.

### 2. Decide which files belong to this task

List the files this task created or changed. Everything else in `git status`
(files that were already modified before the task began, other people's or
the user's work in progress) is **not yours**. Leave it exactly as it is:
unstaged, unstashed and unreset.

If a file holds both this task's changes and unrelated ones, stop and ask
rather than commit someone else's lines.

### 3. Check for things that must never be committed

Look at every file you are about to stage, and at the diff, for:

- secrets: passwords, API keys, access tokens, private keys, connection
  strings with credentials, OAuth client secrets, session secrets;
- environment files: `.env`, `.env.*` (except a committed `.env.example`
  holding no real values);
- data: database dumps, backups, CSV/JSON exports, uploads, anything with
  student or staff personal records;
- build and tool output: `dist/`, `server/dist/`, `client/dist/`,
  `node_modules/`, coverage, logs, caches, large binaries;
- accidental edits: debug code, stray files, unrelated reformatting.

A quick scan of what is staged:

```bash
git diff --staged --name-only
git diff --staged | grep -nEi "(password|secret|api[_-]?key|token|private key|BEGIN .*KEY|postgres(ql)?://[^ ]*:[^ ]*@)" || true
```

Any real hit: unstage it, fix it, and tell the user. If a secret was already
committed or pushed, say so plainly; it must be rotated, not just deleted.

### 4. Verify

Run what the project has and the change warrants:

```bash
npm run typecheck
npm test
npm run build
```

End-to-end suites (`scripts/e2e/*.mjs`) run only against a throwaway local
database with `DATABASE_URL` set explicitly. The project `.env` points at
production.

If a check fails, do not report it as passing and do not push a known broken
or unsafe change. Fix it if you can; otherwise report the failure with its
output and ask how to proceed.

### 5. Check the branch and the remote

```bash
git branch -vv           # current branch and its upstream
git fetch origin
git status -sb           # ahead/behind
```

- **No upstream, or no `origin`:** stop and report it. Do not invent a remote
  or create a branch on GitHub unasked.
- **Behind the upstream:** the remote has work you do not. Do not overwrite it.
  Report it, or integrate with a normal `git pull --ff-only` / merge if that is
  clean and the user's workflow allows; never force.
- **On `main`:** in TDMS, `main` is what Vercel deploys to production, so a push
  there is a deploy. Confirm with the user first unless they asked for that
  push in the same request.

### 6. Stage only this task's files, by path

```bash
git add path/to/file-one.ts path/to/file-two.tsx
```

Never `git add -A`, `git add .`, `git add -u` or `git commit -a`.

### 7. Write the commit message

Conventional Commits, with a subject that says what changed for the user:

```
feat: improve dashboard work queue
fix: resolve dashboard data loading
refactor: extract work-queue rules into shared lib
test: cover secretary dashboard figures end to end
docs: describe the deployment checklist
chore: ignore skill launcher binaries
```

Add a body when the why is not obvious. End with any attribution trailer the
session requires.

### 8. Commit

```bash
git commit -m "<subject>" -m "<body>"
```

If a hook rejects the commit, read why and fix the cause. Never use
`--no-verify`. Never `--amend` a commit that has been pushed.

### 9. Push

```bash
git push                 # to the configured upstream of the current branch
```

Never `--force` or `--force-with-lease` without explicit approval.

### 10. Verify and report

```bash
git status -sb           # should show no "ahead"
git log --oneline -1
```

Report:

- the commit hash and branch;
- the files committed;
- the checks that ran, with their actual results;
- anything left uncommitted on purpose (the user's unrelated changes), and why.

## When something blocks the push

| Situation | Do |
|---|---|
| Merge conflict | Stop. Report the conflicting files. Do not resolve someone else's side by guesswork. |
| Non-fast-forward rejection | Stop. Report that the remote moved. Never force-push. |
| Authentication failure | Stop. Report it. Do not write credentials anywhere; the user signs in through their credential manager or `gh auth login`. |
| Missing remote or upstream | Stop. Report what is missing and the command the user can run. |
| Checks failing | Do not push. Report the failure with its output. |

## Never

- Commit secrets, credentials, `.env` files, production data, dumps or student records.
- Force-push, rewrite shared history, or bypass hooks without explicit approval.
- Reset, stash away, checkout over or discard unrelated working-tree changes.
- Push work the user asked to keep local.
- Make empty commits.
- Store GitHub credentials in CLAUDE.md, a skill, or source files.
- Claim a push or a check succeeded without having seen it succeed.
