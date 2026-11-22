# Pokémon Gym Manager — notes for Claude

- **Spec:** `docs/superpowers/specs/2026-11-17-pokemon-gym-manager-design.md`
- **Plan:** `docs/superpowers/plans/2026-11-17-pokemon-gym-manager.md`
  - Executed with superpowers:subagent-driven-development.
  - The ledger lives in `.superpowers/sdd/` (untracked).
- **Split:** Claude builds the React screens and the pure game rules (`src/game/`). The monday connection (`src/api/monday/`) is Eden's learning track.
  - Since Task 16 (Eden's decision, 2026-11-18): Claude writes the `src/api/monday/` code directly instead of having Eden copy-paste it, but still guides step by step. Look at the real data first (docs, console) and explain each piece so Eden understands what and why before moving on.
- **Git:** follow `docs/GIT_WORKFLOW.md` strictly.
  - No commits to `main`.
  - One branch per topic.
  - Conventional Commits.
  - Push at the end of every session and open or update a PR.
  - Merging into `main` needs Eden's approval (squash merge).
  - **Never switch the branch of the main checkout** (`~/Dev/pokemon-app`). Eden's `npm run dev` + tunnel run from it, and switching makes files vanish under the server. To work on another branch, use `git worktree add .superpowers/wt-<name> <branch>`, then remove it when done.
  - **Commit budget (Eden's explicit requirement):** one commit per plan task. Review fix rounds and small corrections are `--fixup` commits, autosquashed into the task commit **before push**. They are never pushed as separate commits. Say this in every subagent dispatch.
- **Verify before claiming done:** `npx vitest run`, `npm run typecheck`, `npm run build`. For the server (`server/`, Phase 2): `npm --prefix server run check`.
- **Phase 2 plan:** `docs/superpowers/plans/2026-11-22-phase-2-server-telegram.md`, executed inline and slowly (explain each step to Eden). Eden picks every library/tool.
- **Findings about monday's real data shapes** go in `docs/verify-early.md`.
- **The user (Eden) prefers Hebrew** in conversation. Code, commits and docs are in English.
