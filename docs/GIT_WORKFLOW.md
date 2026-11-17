# Git & GitHub workflow

How work on **Pokémon Gym Manager** gets into GitHub. Applies to everyone who commits here: Eden, Claude, and any agent Claude dispatches.

**Rule zero:** if it isn't on GitHub, it didn't happen. Every working session ends with its commits pushed.

Repository: `github.com/edenavgi/pokemon-app`

---

## 1. Branches

`main` is always working: it builds, tests pass, and it only changes through a merged pull request. Nobody commits to `main` directly.

All work happens on a short-lived branch cut from an up-to-date `main`:

| Prefix | Use | Example |
|---|---|---|
| `feat/` | new behaviour (screens, rules, API methods) | `feat/item-view` |
| `fix/` | bug fixes | `fix/router-hash-query` |
| `docs/` | documentation only | `docs/git-workflow` |
| `chore/` | tooling, deps, config | `chore/eslint` |
| `test/` | tests only | `test/battle-edge-cases` |

- Lowercase, hyphen-separated, and short. Name it after the outcome, not the person.
- **One branch = one topic.** It maps to one plan task, or to a small group of tightly related tasks (e.g. `feat/game-rules` for Tasks 5–9).
- **Who works where:** Claude's tasks and Eden's tasks go on separate branches, because they touch different files. Claude never edits `src/api/monday/`. Eden's branches carry an `eden/` scope, e.g. `feat/eden/monday-get-context`.
- Delete the branch after its PR is merged, both locally and on GitHub.

```bash
git switch main && git pull
git switch -c feat/item-view
```

## 2. Commits

Use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`.

```
feat(game): battle engine
fix(router): ignore query monday appends after the hash route
test(router): cover hashchange listener
docs: verify-early findings for mirror columns
chore: scaffold vite+react+shadcn
```

- **Types:** `feat`, `fix`, `test`, `docs`, `chore`, `refactor`, `style`.
- **Summary line:** imperative mood ("add", not "added"), at most 72 characters, no trailing period.
- **Body (optional):** after a blank line, explain *why*, not what. The diff already shows what.
- **One logical change per commit.** Tests and the code they cover go in the same commit, and every commit leaves the suite passing.
- Commits made with Claude end with a `Co-Authored-By:` trailer.

### Commit budget: keep history tight

The history should read like a list of what was built, not a diary of how.

- **One commit per plan task.** A task is one `feat`/`fix` commit with its tests. Not one commit per step, per file or per test.
- **Review fixes are not commits of their own.** A fix after review, a typo or a forgotten test is folded into the commit it belongs to: `git commit --fixup=<sha>`, then `git rebase -i --autosquash main` **before pushing**. "address review", "fix typo" and "wip" never reach GitHub.
- **Out-of-plan fixes** (a real bug found along the way) get exactly one `fix:` commit.
- **Docs travel with their change.** A doc that explains a code change goes in that commit. Standalone docs work is one `docs:` commit per branch.
- **Rewrite only before push.** Once a branch is pushed and someone may have pulled it, fixes go in as new commits, and the PR is squash-merged.
- **Rough target:** 1–4 commits per feature branch. More than ~5 is a signal to squash or split the branch.

On `main`, every PR becomes **one squash commit**, so `main` reads as one line per feature.

## 3. Pull requests

Every branch reaches `main` through a PR.

1. Push the branch: `git push -u origin <branch>`.
2. Open a PR into `main`.
   - **Title:** a Conventional Commit summary.
   - **Description:**
     - **What & why:** 2–4 lines.
     - **Plan task(s):** for example `Task 5 — status rules`.
     - **How it was verified:** the commands that were run (`npx vitest run`, `npm run typecheck`, `npm run build`) and what was checked by hand inside monday.
     - **Screenshot:** for anything visible in monday.
     - **Follow-ups:** anything left open.
3. **Before merging:**
   - CI/local checks are green.
   - The other person (Eden ⇄ Claude) has looked at it.
   - Eden approves every merge into `main`.
4. **Merge** with **Squash and merge** (the default). The squash commit title is the PR title, in Conventional Commit form.
5. Delete the branch.

Keep PRs reviewable. Aim for less than about 400 changed lines, excluding `package-lock.json`. Split bigger work.

## 4. Never commit

- **Secrets:**
  - monday API tokens
  - `.mappsrc`
  - `.env.local`
  - session tokens copied from URLs or logs

  If one slips into a commit, **rotate it in monday first**, then remove it from history. Deleting it in a later commit is not enough.
- **Account-specific IDs in `src/`**, such as board, item or column IDs. Mock fixtures and docs are the only exception.
- **Build output** (`dist/`), `node_modules/`, and the `.superpowers/` scratch area.

All of these are already in `.gitignore`. Run `git status` before every commit anyway.

## 5. Keeping history clean

- Update your branch from `main` with `git pull --rebase origin main` while it's private. Once a branch is shared (PR open, someone else working on it), merge `main` into it instead.
- Never force-push `main`. On your own branch, use `git push --force-with-lease`, and only if no one else has pulled it.
- Don't rewrite commits that are already in `main`.

## 6. Releases

Each deploy to monday code is tagged on the merged `main` commit:

```bash
git tag -a v0.1.0 -m "First deploy: item view + board view"
git push origin v0.1.0
```

Use semantic versioning: bump `minor` for new features, `patch` for fixes.

## 7. Quick checklist (end of every session)

- [ ] `npx vitest run` and `npm run typecheck` pass
- [ ] `git status` is clean, or the leftovers are intentional
- [ ] Commits follow the Conventional Commits format
- [ ] The branch is pushed
- [ ] A PR is open (or updated) with its description filled in
