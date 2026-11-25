# monday concepts used

For each feature: which monday concept it uses and why. Details of the real data shapes live in `verify-early.md`.

## 6.1 Item view: Pokémon profile
- **Concepts:** item view feature, `monday.get("context")` and `monday.listen("context" | "events")`, a GraphQL `items(ids: [...])` query through `SeamlessApiClient`.
- **Why:** an item view runs inside one item's card, so the context tells the app *which* item it is on (`itemId`). No IDs are hardcoded. The query reads that item's columns, mapped by column title. `listen("events")` fires on every change to the board; the app keeps only events whose `itemIds` include its item, so the profile refreshes live.
- **Talk (6.7):** the `run_prompt` mutation (API 2026-10+, model `MONDAY_FAST`), with a system prompt built from PokéAPI data.

## 6.2 Board view: gym roster
- **Concepts:** board view feature, `boards(ids: [...]) { items_page { items } }` for all items of the board in context, Connect boards (`BoardRelationValue.linked_item_ids`) and Mirror (`MirrorValue.display_value`).
- **Why:** a board view knows its board from the context (`boardId`), so it lists the gyms of exactly that board. Each gym's Connect column gives the IDs of its Pokémon. A second query, `items(ids: [...all IDs...])`, fetches every Pokémon of every gym at once: two queries in total, however many gyms there are, instead of one query per Pokémon.
- **Why the mirror alone isn't enough for the cards:** a mirror returns one display string for one mirrored column (Level → `"5, 7"`). A card needs the name, sprite and status, and needs to know which level belongs to which Pokémon. So the mirror is used only for aggregates (count, average level), and the cards come from the linked items themselves.
- **Limits:** `items_page` returns at most 500 items per page (`cursor` is not null when more remain), and `items` returns at most 100 items. The app warns in the console when it reaches either limit.

## 6.3 Dashboard widget: gym and status stats
- **Concepts:** dashboard widget feature, the widget context (`boardIds` → `widgetBoardIds`, the boards connected to the widget), SDK **global storage** (`monday.storage.getItem` / `setItem`), a `boards` query for the board picker, and `items_page` on each connected board.
- **Why:** a widget lives on a dashboard, not on a board, so it can't know which board is "Gyms" and which is "Pokémon" from the context alone. The user picks them once in BoardSetup. The choice is saved as JSON in **global** storage, which is shared by every widget and view of the app in the account (`monday.storage.instance` would make each widget ask again). The widget then compares its connected boards with that config to decide what it can show.
- **One board or two:** with only Gyms connected, the per-gym count and the average level come from the gym items and the Level mirror (`"5, 7"` → 6.0). With only Pokémon connected, it groups the Pokémon by their Gym link. Status counts need the Pokémon board.
- **The board picker:** `boards(limit: 100, order_by: used_at)` returns the recently used boards first. The default limit is 25, too few for a busy account. It keeps only `type: "board"`, dropping docs, subitem boards and custom objects.

## 6.4 Board multi-item menu: Spar and Transfer
- **Concepts:** the **board multi-item menu** feature (it opens from the bar that appears when items are selected, and the context gives `selectedPulsesIds`), the **`change_multiple_column_values`** mutation with **GraphQL aliases**, and `monday.execute("notice")` / `monday.execute("closeAppFeatureModal")`.
- **Why:** the action works on the selected Pokémon. The app validates everything with the game rules before the first write, so an invalid action changes nothing and shows a red notice. Writes need **column IDs**, not titles: one query reads each item's board and columns, then one request sends one aliased mutation per item (`w0: change_…`, `w1: change_…`). Sparring two Pokémon is two writes in a single request.
- **Write formats** are the reverse of the read shapes: numbers as `"6"`, status as `{ label }`, dropdown as `{ labels: [...] }`, link as `{ url, text }`, Connect boards as `{ item_ids: [...] }`.
- **Notices and closing:** the app runs in an iframe, so it asks monday to show a toast (`notice`) or close its window (`closeAppFeatureModal`).
- **Not atomic:** mutations in one request run one after another. If one fails, earlier ones stay. Validating first keeps this unlikely.

## 6.5 Status column dialog: transitions, Rest and Evolve
- **Concepts:** a **Status column** feature with an **on-click dialog** (the context gives `itemId` and `columnId`), the **updates API** (`create_update`), writing column values including the item **name**, and PokéAPI **evolution chains**.
- **Why:** clicking a cell opens the app inside monday for that one item. The dialog offers only the moves the game rules allow and writes the new status back with `change_multiple_column_values`. Evolve writes the new form's name, sprite, stats and types in the same mutation, leaving level, gym and status alone, and then posts "X evolved into Y" as an update on the item. That history lives in monday, not in the app.
- **Evolution chain:** PokéAPI returns a tree (`evolves_to`). The app finds the path from the root to the Pokémon. The stage is the number of Gen-1 forms on that path, and the next forms are the children of the last node. A form evolves "by level" only if PokéAPI gives a `min_level`. Chains are cached per chain, because Charmander, Charmeleon and Charizard share one.
- **In development:** the feature is attached through the Column Center (Development Apps), which adds its own "Status & Evolve" column. That column is only the entry point; the dialog still writes the original Status column.

## 6.6 Gym HQ: create gym, recruit, battle
- **Concepts:** **`create_item`** with column values (a dropdown for the gym's type; numbers, dropdown, link, status and a **Connect boards** value for a recruit), `create_update` on both gyms (battle log), PokéAPI **type** lists (damage relations + the Pokémon of each type), and SDK **global storage as a cache**.
- **Why one mutation per recruit:** the new Pokémon item gets its stats, its starting level/energy/status and its gym link in a single `create_item`, and the same request reads the new item back. The two-way Connect column then adds it to the gym's roster by itself. There's no half-created Pokémon without a gym.
- **Why 18 requests, not 151:** each `type/{name}` response lists every Pokémon of that type, so the 18 types give both the type chart (for battles) and the types of all 151 Gen-1 Pokémon (for the Recruit grid). The result is saved in global storage, so later visits don't call PokéAPI at all.
- **Feature type:** it was designed as a **custom object** (a standalone page in the workspace menu). A custom object can't be added until the app is **installed**, and only admins install apps in our account (`verify-early.md` §10). **Decision (2026-11-19): Gym HQ is a board view ("Gym HQ View") on the Gyms board, for good.** The custom object feature was deleted from the Developer Center. The screen reads the boards from the saved board config, not from the context, so it doesn't care where it is opened.

## Summary: which monday concept each feature uses

| Feature | monday feature type | Main API / SDK concepts | Status in monday |
|---|---|---|---|
| 6.1 Pokémon profile | Item view | `get("context")`, `listen("events")`, `items(ids)` | ✅ works |
| 6.7 Talk | (inside 6.1) | `run_prompt` mutation (2026-10+) | ✅ works |
| 6.2 Gym roster | Board view | `boards → items_page`, Connect + Mirror, one `items(ids)` for all rosters | ✅ works |
| 6.3 Stats widget | Dashboard widget | widget context `boardIds`, SDK global storage, `boards` list | ✅ works (1 and 2 boards) |
| 6.4 Spar / Transfer | Board multi-item menu | `selectedPulsesIds`, `change_multiple_column_values` with aliases, `execute("notice")`, `closeAppFeatureModal` | ✅ works |
| 6.5 Status & Evolve | Status column (on-click dialog) | column context, writes incl. item `name`, `create_update`, PokéAPI evolution chains | ✅ works |
| 6.6 Gym HQ | Board view (instead of a custom object) | `create_item` with a Connect write, updates, PokéAPI type lists, storage cache | ✅ works as a board view |

## Phase 2: the server on monday code

Phase 2 moves the battle and every "act for the user while they're away" job to a server on **monday code**. The ideas below are what each part is built on, and why.

### OAuth 2.1 with PKCE (Connect to monday)
- **What:** the server gets the user's own monday token, so the Telegram bot, the queue and the scheduler can act as that user when nobody has monday open.
- **Flow:** the app asks the server to start (`POST /api/oauth/start`). The server makes a random `state` (single use, 10 minutes, bound to the user) and a PKCE pair, and returns monday's consent URL. monday redirects to `/oauth/callback`, where the server swaps the code + the PKCE **verifier** for a token, checks with `me()` that the token belongs to the user who started, and saves it in **Secure Storage** keyed by user id.
- **Why PKCE:** only the verifier's SHA-256 travels in the URL, so a stolen code is useless without the verifier, which never leaves the server.
- **Why the new flow:** the OAuth 2.1 tokens expire and come with a refresh token. The token store refreshes them by itself, and a refused refresh means "reconnect".
- **Scopes:** the version's scopes are what the user approves. After trimming them, **Reconnect to monday** gets a token with the new set (`verify-early.md` §22).

### sessionToken (app → server)
- **What:** every call from the app carries monday's **sessionToken** (`monday.get('sessionToken')`), a JWT signed with the app's **client secret**. The server checks it (HS256) and reads the user and account ids from it.
- **Why:** the server never trusts an id sent by the browser, and the app never holds a monday token of its own.

### The queue and idempotency (Arena battles)
- **What:** `POST /api/battles` saves the battle as `queued` and **then** publishes `{battleId}` to the monday code **Queue**, which delivers it to `/mndy-queue`.
- **Why it's safe to deliver twice:** the queue delivers *at least once*, so every step can repeat:
  - an atomic **claim** (only one worker moves `queued → running`)
  - a **snapshot** saved once
  - a fixed **seed** (the same battle every time)
  - **absolute** board values ("Energy = 2", never "−1 again")
  - **flags** for steps already done (board, updates, card, Telegram reply)
- **Replay:** turns are written to Document DB while the battle runs, so the app replays exactly what happened.

### Wide events (logging)
- **What:** each request, queue delivery and cron run writes **one** JSON log line with everything about it: `traceId`, user, battle, counts of monday/Telegram calls, cache hits, errors.
- **Why:** one line per unit of work can be searched and read whole. The same `traceId` follows a battle from the webhook through the queue to the Telegram reply.

### Scheduler (cron)
- **What:** a monday code scheduler job calls `POST /mndy-cronjob/energy-regen` every hour on the **live** version. It gives +1 Energy to every Pokémon below full on every connected user's board.
- **Why hour marks:** a `regen_marks` row per board and UTC hour is claimed before writing. A retry or a duplicate delivery in the same hour is skipped, so nobody gets +2.

### Storage on monday code
- **Key-value Storage:** caches PokéAPI with a 30-day TTL. It stores **strings**, so values are JSON.
- **Object storage:** holds the battle cards (`cards/<id>.png`).
- **Secure Storage:** holds OAuth tokens.
- **Document DB:** holds the game's records (users, links, battles…).

| Phase 2 part | monday code / platform concept |
|---|---|
| Connect to monday | OAuth 2.1 + PKCE, Secure Storage, `me` |
| App → server calls | sessionToken (JWT, client secret) |
| Arena | Queue (at-least-once), Document DB |
| Telegram bot | the user's OAuth token, `run_prompt`, Document DB (links, update ids) |
| PokéAPI cache | key-value Storage with TTL |
| Energy refill | scheduler, live version |
| Battle card | Object storage, `/v2/file` (`add_file_to_update`) |
