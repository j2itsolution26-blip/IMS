## Mandatory Analysis-First Development

For every significant coding task, inspect the existing implementation,
understand the requirements, identify risks, and present a proposed plan
before changing application source code.

Wait for my approval before implementing significant features,
architectural changes, database modifications, or security-sensitive work.

After approval, implement the solution and run the relevant available
checks. Preserve existing behavior and report actual verification results.

For trivial, low-risk changes, use a proportionate lightweight workflow.
Never perform destructive operations without explicit authorization.

## Mandatory Git Workflow: Commit and Push Completed Work

After each completed coding task that modifies project files, commit the
task's changes and push them to the current branch's configured upstream
on GitHub. Use the `git-auto-sync` skill (`.claude/skills/git-auto-sync/`)
for the full procedure. In short:

1. Review the changes and inspect `git diff`.
2. Identify which files belong to the current task.
3. Check for accidental changes, exposed secrets, credentials, tokens,
   environment files, database dumps, build artifacts and unrelated files.
4. Run the relevant tests, type checks and production build when available
   (`npm run typecheck`, `npm test`, `npm run build`; e2e suites only
   against a throwaway local database, never the production `.env`).
5. Check `git status` and the upstream, and make sure the push cannot
   overwrite anyone else's work.
6. Stage only the files that belong to the completed task, by path. Never
   `git add -A`, `git add .` or `git commit -a`, and never stage unrelated
   user changes.
7. Write a descriptive Conventional Commits message, e.g.
   `feat: improve dashboard work queue` or `fix: resolve dashboard data loading`.
8. Commit.
9. Push to the current branch's configured upstream.
10. Verify the push succeeded and report the commit hash, branch, files
    changed and verification results.

Safety rules:

- Never commit secrets, passwords, API keys, access tokens, private keys,
  `.env` files, production data, database dumps or student records.
- Never force-push, rewrite pushed history, bypass hooks (`--no-verify`)
  or run destructive Git commands without explicit approval.
- Never reset, stash away or discard unrelated working-tree changes.
- On a merge conflict, authentication failure, missing remote or upstream,
  or non-fast-forward rejection: stop and report the blocker. Never
  overwrite remote work.
- If checks fail, do not claim they passed and do not push a known broken
  or unsafe change; explain the failure and fix it where possible.
- `main` is the branch Vercel deploys to production: a push to `main` is a
  production deploy. Confirm with me before pushing to `main` unless I
  asked for that push in the same request.
- Do not push work I asked to keep local. Do not make empty commits.
- Never store GitHub credentials in this file or in source files.
- Read-only tasks (analysis, plans, investigations) change no project
  files and so produce no commit.
