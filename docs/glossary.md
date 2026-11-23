# Glossary

Short definitions of the terms used in this project, with where each one shows up here. For how each monday feature uses them, see `concepts.md`. For monday's real data shapes, see `verify-early.md`.

## Basics

- **Hook:** a point in a system where you can attach your own code, and the system calls it when that moment comes. Examples: `useEffect` in React, the `pre-commit` hook in git.
- **Webhook:** the same idea between servers. An outside service sends a POST to your URL when something happens on its side. Here, Telegram sends every message the bot receives to `server/src/telegram/webhook.ts`.
- **Polling:** the opposite of a webhook. The server keeps asking "anything new?". Not used here.
- **Tunnel:** gives a server running on `localhost` a public URL, so Telegram and monday can reach it during development.
- **iframe:** a page embedded inside another page. The app runs in monday's iframe, so it asks monday to show a toast or close a window through `monday.execute`.

## monday

- **Board / item:** a board is a table in monday. We have two, Gyms and Pokémon. Each row is an item.
- **Feature:** a place in monday where the app appears. We use an item view, a board view, a dashboard widget, a board multi-item menu and a status column.
- **Context:** what monday tells the app about where it runs (`itemId`, `boardId`, `selectedPulsesIds`). It's why no IDs are hardcoded.
- **Connect boards:** a column that links an item to items on another board. It's how a gym knows its Pokémon.
- **Mirror:** a column that shows a value from the linked items as one string, e.g. levels as `"5, 7"`.
- **Storage:** the SDK's key-value store. Global storage holds the board config and the PokéAPI cache.
- **Updates:** the posts on an item. Battle logs and "X evolved into Y" live there.

## GraphQL and the API

- **GraphQL:** the language of monday's API. You ask for exactly the fields you need.
- **Query / mutation:** a query reads data. A mutation changes it (`create_item`, `change_multiple_column_values`).
- **Alias:** a name for each part of a request (`w0:`, `w1:`), so several mutations fit in one request.
- **Pagination:** getting results page by page. `items_page` returns up to 500 items, and `cursor` asks for the next page.
- **Rate limit:** a cap on how many requests you can make. One reason we batch work into fewer requests.

## Security and identity

- **JWT:** a signed string that carries data. Changing any part of it breaks the signature.
- **sessionToken:** the JWT monday gives the app. It proves to our server which monday user is calling. It can't call monday's API. See `server/src/auth/sessionToken.ts`.
- **OAuth:** the flow where a user lets the server act for them in monday. It ends with an access token.
- **Access token / refresh token:** the access token expires soon. The refresh token gets a new pair, and it rotates: every refresh returns a new refresh token and the old one stops working.
- **Secure Storage:** monday code's store for secrets. The OAuth tokens live there, not in the database.
- **Secret token:** the secret Telegram sends with every webhook call. The server checks it to know the call really came from Telegram.
- **Hash:** a one-way fingerprint of a value. Only the hash of a link code is stored, so a database leak gives no usable codes.
- **Link code:** a one-time code, valid for 10 minutes. The user opens `t.me/<bot>?start=<code>`, and that Telegram chat gets linked to their monday user. See `server/src/telegram/linking.ts`.
- **Middleware:** an Express function that runs before a route. `requireSession` checks the sessionToken and answers 401 when it's invalid.

## The server (Phase 2)

- **Express:** the library the server is built with. It takes HTTP requests and hands them to routes.
- **Route:** a URL plus a method mapped to code, e.g. `POST /api/battles`.
- **monday code:** monday's hosting, where the server runs.
- **MongoDB:** the database for battles and Telegram links.
- **Queue:** a message queue. The server publishes "new battle", and the battle runs in the background.
- **At-least-once:** the queue promises every message arrives, but one may arrive more than once.
- **Idempotent:** safe to repeat, because the result is the same. That's why the board gets "Energy = 2" and never "Energy − 1". See `server/src/battle/service.ts`.
- **Seed:** the starting number for randomness. The same seed gives the same battle, so a battle can be re-run and replayed.
- **Wide event:** one big log record per request with all its details, instead of many small lines.

## Workflow and tools

- **Branch:** one per topic. Nobody commits to `main` directly.
- **Worktree:** another checkout of the repo on another branch. It's how you work on a branch without switching the main checkout, where the dev server and tunnel run.
- **Squash merge:** merging a PR as a single commit on `main`.
- **Fixup commit:** a small correction folded into the task's commit before push.
- **Conventional Commits:** the commit message format, e.g. `feat(telegram): ...`.
- **Mock:** a fake implementation of the API (`MockGameApi`) for development and tests without a real monday.
