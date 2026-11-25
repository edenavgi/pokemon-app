# Verify early — findings

API version: `2026-10`. Source: query run in the API Playground on 2026-11-17 against the Gyms and Pokemon boards (2 gyms, 2 Pokémon).

## 1. Context per feature type
**Iframe URL (item view, seen 2026-11-17):** monday loads the feature URL and appends its own query **after the hash**:
`/#/item-view?boardId=…&itemId=…&itemViewId=…&sessionToken=…&instanceId=…` (`location.search` is empty).
→ The router reads only the part of the hash before `?` (fixed in `src/router.tsx`, test in `router.test.tsx`).
→ `boardId`/`itemId` are visible in the URL, but read them from `monday.get("context")` — the documented source, and it also updates via `listen`.

**Item view context (`monday.get("context")`, seen 2026-11-17 on Charmander):**

| Field | Example | Type |
|---|---|---|
| `boardId` | `18440319935` | **number** |
| `itemId` | `13567521117` | **number** |
| `boardIds` | `[18440319935]` | number[] |
| `theme` | `"light"` | string |
| `instanceType` | `"item_view"` | string |
| `appFeature` | `{ type: 'AppFeatureItemView', name: 'Pokemon Profile - v1' }` | object |

Not present in an item view: `columnId`, `selectedPulsesIds`.
→ `getContext()` (`src/api/monday/index.ts`) converts every ID to a string (the contract's `Id = string`), maps `selectedPulsesIds` → `selectedItemIds` and `boardIds` → `widgetBoardIds`, and leaves fields that are absent as `undefined`.
→ monday-sdk-js ships its types as `.ts` files that fail our strict tsconfig, so `tsconfig.app.json` maps the module to the local types in `src/types/monday-sdk-js.d.ts`.

**Board events (`monday.listen("events")`, seen 2026-11-18 in the item view, changing Charmander's Level from another tab):**

```
{ type: "change_column_values", boardId: 18440319935, itemIds: [13567521117],
  columnId: "numeric_mm96ne2j", columnType: "numeric", columnValue: "3" }
```
- `itemIds` is an **array of numbers** (not a single `itemId`, not strings) → compare with `itemIds.map(String).includes(itemId)`.
- The event fires for **every** change on the board (Squirtle too), so `onItemChanged` filters by item ID before calling back.
- The listener lives only while the feature's iframe is open: a change made while the item card is closed is never heard.

**Status column dialog context (`monday.get("context")`, seen 2026-11-18, clicking Charmander's cell):**
`{ boardId: 18440319935, itemId: 13567521117, columnId: "color_mm97h66p", appFeature: { type: "AppFeatureDialog", name: "Dialog feature - v1" } }`. IDs are numbers, as in the item view. Other keys: `columnType`, `event`, `placement`, `hover`, `click`, `selectedItemIds`, `permissions`, `appFeatureId`. There is no `instanceType`.
- **Logging the context:** `console.log(res.data)` shows "No properties" when expanded, because the object arrives through postMessage. Log `JSON.stringify(...)` instead.
- **Attaching it (development):** the Status-column feature does **not** appear under the column's ⋯ → *Column extensions* (installed apps only). It does appear under **Add column (+) → More columns → Column Center → Development Apps → "Status & Evolve" → Add to board**. That adds a **new** status column ("Status & Evolve") with the extension. Clicking its cell opens the dialog, and `columnId` is that new column. The dialog reads and writes the original `Status` column by title, so the new column is only the entry point.

**Other features (what the code relies on, seen working 2026-11-18):**

| Feature | Context fields used | Notes |
|---|---|---|
| Board view (Gym Roster) | `boardId` | → `listGyms({ boardIds: [boardId] })`. Opened from Views Center → Development Apps → Open in board. |
| Dashboard widget (Gym Stats) | `boardIds` → `widgetBoardIds` | Changes live when the dashboard's connected boards change (§7). Added via Add widget → Development Apps. |
| Board multi-item menu (Spar selected / Transfer to gym) | `selectedPulsesIds` → `selectedItemIds`, `boardId` | Found by **searching the feature name** in the selection bar's Apps menu (§8). |
| Status column dialog | `itemId`, `columnId`, `boardId` | See above. |
| Board view (Gym HQ View) | — (uses the saved board config) | Gym HQ is a **board view** instead of a custom object (§10). Opened from Views Center → Development Apps. |

## 2. Column value shapes (GraphQL)

| Column type | `text` | `value` | Type-specific field | How to read it in code |
|---|---|---|---|---|
| **numbers** (`Level`, `HP`…) | `"4"` | `"\"4\""` (a JSON-encoded string) | — | `Number(cv.text)`; empty cell → `text` is `""`/`null` → treat as missing |
| **dropdown** (`Types`) | `"Fire"` (labels joined by `, ` when several) | `{"ids":[2]}` — **ids only, no labels** | `... on DropdownValue { values { id label } }` | `cv.values.map(v => v.label)` — don't split `text` |
| **status** (`Status`) | `"Recruited"` | `{"index":7}` | `... on StatusValue { label index }` | use `label`. ⚠️ `index` is **7**, not the 0 we passed when creating the label — the index is tied to the colour, not the display order. Never rely on it |
| **link** (`Sprite`) | `"Charmander - https://…/4.png"` | `{"url":"…","text":"Charmander","changed_at":null}` | — | `JSON.parse(cv.value).url` — `text` mixes name and URL |
| **board_relation** (`Gym`, `Pokemon`) | **`null`** | **`null`** | `... on BoardRelationValue { linked_item_ids display_value }` | `cv.linked_item_ids` (array of string IDs). ⚠️ `text`/`value` are always null → without the fragment the link is invisible |
| **mirror** (`Level (mirror)`, `Gym type (mirror)`) | **`null`** | **`null`** | `... on MirrorValue { display_value }` | only `display_value` carries data, as **one string** (`"1"`, `"Fire"`) |

### Mirror with several linked items (answered 2026-11-18)
Experiment: linked Squirtle (Level 7) to Cinnabar next to Charmander (Level 5), ran the Gyms query, then reverted.
- `Pokemon.linked_item_ids` → two IDs; `Level (mirror).display_value` → **`"5, 7"`**: one string, values joined by **comma + space**, in the same order as the links.
- → parse with `split(",")`, `trim()`, drop empty parts, `Number()`; an unlinked gym gives `""` → `[]`. Use the mirrored numbers only for aggregates (count, average), never to pair a level with a Pokémon — the cards need the linked items themselves (one `items(ids:[…])` query).
- Gyms query: `boards(ids:$boardIds) { items_page(limit: 500) { cursor items {…} } }` — default limit 25, max 500; `cursor: null` means no further page.

## 3. SeamlessApiClient from the iframe
`new SeamlessApiClient("2026-10")` works from the item view iframe with no token: monday runs the request as the signed-in user (seen 2026-11-18).
- ⚠️ `client.request(...)` resolves to an **envelope**, not the GraphQL data: `{ method: "api", requestId, headers, data: { data: { items: [...] }, extensions } }` → the items are at `res.data.data.items` (seen 2026-11-18).
- One `items(ids:[…]) { column_values { column { title } … } }` query returns all 12 Pokémon columns; map them **by title** (no column IDs in code).
- The screen shows only `Graphql validation errors`; the real reason is in the thrown error's `response.errors[0].message`. Log it when a query fails.
- Without the app's OAuth scopes every query fails with `Unauthorized to load field 'Query.items', Reason: missing required scopes.` → set the scopes in the Developer Center (**OAuth & Permissions**): `boards:read`, `boards:write`, `updates:write`, `me:read`, `workspaces:read`, `AI:Consume`.
- The scope list in **Build → OAuth & permissions** is now granular (`account:read`, `apps:read`, `assets:read`, `boards:create`…), not just the six names above. With only some scopes checked, `Query.items` still failed; **checking all scopes fixed it, with no install** (the app is still "not installed"; only account admins can install in our Enterprise account). So the developer's own preview gets the draft version's scopes without an install.
- **Open item:** all scopes are still checked (development). Before anyone installs the app, trim them to the minimum (least privilege). Every checked scope is shown to the installing admin.

## 4. Resolving column IDs without hardcoding
Column IDs are account-specific and random (`numeric_mm96ne2j`, `lookup_mm96y2hj`…). They also change if a column is deleted and recreated (seen with the Gyms mirror: `lookup_mm962j39` → `lookup_mm96y2hj`).
→ Resolve once per board with `boards(ids:[…]) { columns { id title type } }` and match by **title + type**. Titles must therefore be unique per board (we deleted a duplicate `Status` for this reason).
**How the code does it:**
- **Reads:** every query asks for `column_values { column { title } … }`, and `columnReader(columnValues, board)` maps the values by **title**, throwing `<board> board: missing column "<title>"` if one is missing. No column IDs are needed for reading.
- **Writes:** `writeItems()` first queries `items(ids) { board { id columns { id title } } }`, then translates titles → IDs for `change_multiple_column_values` (§8). One read and one write request per action; nothing is hardcoded.
- Titles the code expects: Pokémon board — `Pokédex number`, `Types`, `Sprite`, `HP`, `Attack`, `Defense`, `Speed`, `Level`, `Energy`, `Status`, `Gym`, `Gym type (mirror)`; Gyms board — `Type`, `Pokemon`, `Level (mirror)`.

## 5. `run_prompt` from the browser
**Works** from the item view iframe through `SeamlessApiClient("2026-10")` (seen 2026-11-18: Charmander replied). Docs: https://developer.monday.com/api-reference/reference/ai

```graphql
mutation ($prompt: String!, $config: RunPromptConfigInput) {
  run_prompt(prompt: $prompt, config: $config) { content }
}
```
- `prompt` (`String!`, must not be empty) = the user turn; `config` is optional: `{ model, system_prompt, temperature, max_tokens }`.
- `model` is an enum (`MONDAY_FAST`, `MONDAY_STANDARD`…): bare in an inline query, but a **string** (`"MONDAY_FAST"`) when passed through variables.
- The reply is at `res.data.data.run_prompt.content` (the same SeamlessApiClient envelope as §3).
- Needs a scope from the AI group (`ai:consume` in the Developer Center list) — covered by checking all scopes during development.
- On failure `talk` logs `[talk] run_prompt failed` with `response.errors` and rethrows; the Talk panel shows the friendly fallback.
- **From the server (Phase 2, Task 12, 2026-11-24):** `run_prompt` also works with the user's **OAuth token** (ApiClient, API `2026-10`), not only with the iframe's seamless auth. Checked live: `/talk charmander` in Telegram got a reply from the cloud draft.

## 6. PokéAPI (`getSpecies`)
- Two calls per species, in parallel: `pokemon/{n}` (types, stats, sprite) and `pokemon-species/{n}` (display name, flavor text).
- `pokemon.name` is a technical slug (`mr-mime`, `nidoran-f`) → the display name comes from `species.names[]` where `language.name === "en"` (`Mr. Mime`).
- Types are lowercase (`fire`) → capitalised to match `PokeType`. Stats are an array searched by `stat.name`.
- English flavor text contains `\n` and `\f` → collapsed with `.replace(/\s+/g, " ")`. It also splits words across lines with a **soft hyphen** (U+00AD): #65 Alakazam is `"out\u00ad\nperform a super\u00ad\ncomputer"`. `cleanFlavorText` removes the soft hyphen and the line break after it first, so it reads "outperform a supercomputer" (seen 2026-11-19).
- Cached in memory per page load as a `Promise` per dex number (concurrent calls share one request; failures are not cached).

## 7. SDK storage and the widget context (Task 16, 2026-11-18)
- `monday.storage.getItem(key)` → the value is at `res.data.value` (a string). The docs don't say what an unsaved key returns, so treat any falsy value as "not saved". `setItem(key, value)` reports `res.data.success`. Values are strings (6MB per key): store `JSON.stringify(cfg)`.
- **Global** storage (`monday.storage.*`) is scoped to account + app and shared by every feature instance. `monday.storage.instance.*` is per instance and resets on a new major version.
- The widget's connected boards (dashboard "connected boards") arrive in the context as `boardIds` and change live when boards are added or removed. Checked with one board (Gyms only → hint) and with two.
- A feature's **Custom URL** in Developer Center → View Setup is only kept once it is saved for the feature. An empty field on reload means the URL was never stored, and the widget renders blank.

## 8. Writing column values and board menu actions (Task 18, 2026-11-18)
- `change_multiple_column_values(board_id, item_id, column_values: JSON!)` takes **column IDs** as keys and a **JSON string** as the value. The IDs come from `items(ids) { board { id columns { id title } } }`, so nothing is hardcoded. Several items go in one request with aliases (`w0:`, `w1:`).
- Formats used: number `"6"`, status `{"label":"Ready"}`, dropdown `{"labels":["Fire"]}`, link `{"url","text"}`, connect `{"item_ids":[<gymId>]}`.
- **Connect boards write replaces** the links rather than appending (the docs don't say). Seen: Transfer moved Charmander from Cinnabar to Cerulean, and the Gym cell then showed only Cerulean. The two-way link updated the Gyms board by itself.
- Board **multi-item menu** features of an uninstalled (development) app do **not** appear in the Apps list of the selection bar, but they **do** appear when you search for the feature's name ("Transfer to gym", "Spar selected").
- `monday.execute("notice", { message, type, timeout })` shows the toast. `closeAppFeatureModal` closes the multi-item menu window.
- **`"name"` in `column_values` renames the item.** Seen in Task 20: Evolve renamed Charmander → Charmeleon → Charizard on the board, and changed sprite, stats and types in the same `change_multiple_column_values` call.
- `closeAppFeatureModal` also closes the Status-column **dialog**. The SDK docs pair `closeDialog` with the AI assistant, but it isn't needed here.

## 9. Evolution chains and updates (Task 20, 2026-11-18)
- `pokemon-species/{n}.evolution_chain.url` → `evolution-chain/{id}`, a **tree**: `chain { species{name,url}, evolution_details[], evolves_to[] }`. The dex number is the last path segment of `species.url`.
- **Baby forms outside Gen 1** sit at the root (Pichu #172 → Pikachu). Count the stage over Gen-1 nodes only, or Pikachu would be stage 2.
- `evolution_details` is an **array**, with one entry per game version (Leafeon has 8). A form counts as `level-up` only when some entry has `trigger.name === "level-up"` **and** a `min_level`. A level-up without a level (friendship: Crobat, Espeon) or `use-item` counts as `other`.
- `next` is not filtered to Gen 1, so `evolutionCheck` can say "outside Generation 1" (Golbat → Crobat #169). Eevee has 8 branches, which gives `BRANCHING`.
- Checked live against PokéAPI: 4 → stage 1, next Charmeleon (level-up@16); 5 → stage 2; 6 → stage 3, none; 25 → stage 1, Raichu other; 133 → stage 1, 8 options; 42 → stage 2, Crobat other; 1 → stage 1, Ivysaur.
- The game's thresholds come from the spec (stage 1→2 at level 3, 2→3 at level 6). PokéAPI's `min_level` only tells whether a form evolves by level.
- `create_update(item_id: ID, body: String!) { id }` posts in the item's Updates tab. Seen: "Charmander evolved into Charmeleon".

## 10. Gym HQ: the custom object needs an installed app (Task 22, 2026-11-19)
The app's **Object** feature ("Gym HQ", key `moveogroup_pokemon-gym-manager::gym-hq`) shows up in the workspace **+ → Apps** menu and in `object_types_unique_keys`, but it **can't be added** while the app is not installed. Listed doesn't mean creatable.
- **UI:** + → Apps → Gym HQ sends `POST /accounts/add_board_template` (`app_feature_id`, `template_board_id`, `workspace_id`, `folder_id`) → **403 Forbidden** with an empty body. The user sees the toast "contact the developer".
- **API:** `create_object(name, privacy_kind, object_type_unique_key, workspace_id, owner_ids)` → `INTERNAL_SERVER_ERROR`.
  - Same result with or without `workspace_id`, in 2026-07 and 2026-10, from the Playground and from the iframe.
  - request_ids: `db7774d5-60c8-9648-9a4f-22fa1eb15046`, `71fa94e0-c022-9ff2-838e-ac83b053d869`, `f09eb29c-fd73-9548-958d-0a4f2dc4264c`, `99635cee-797d-9c60-82f5-b8785c267ea6`.
- **Not Gym HQ's settings:** a brand-new default Object feature failed the same way (`0445834d-1134-9684-a3f4-5936e01e5724`; the probe feature was deleted afterwards). The build URL (tunnel or zip upload) doesn't matter either: creation fails before any URL loads.
- **Not a board permission:** the same user created the Pokemon board in the same folder.
- **What works:** an *installed* moveogroup app's object ("Developer Course") lives in the same workspace. The docs add objects from **+ → Apps → Installed** (developer.monday.com/apps/docs/custom-objects).
- Every other feature type (item view, board view, widget, multi-item menu, status column) works **without** an install. A custom object is the first one that doesn't: it creates a new workspace entity from a template, instead of being added to an existing board.
- **In our Enterprise account only admins install apps.** Decision (Eden, 2026-11-19): Gym HQ is the board view **"Gym HQ View"** for good (same `#/gym-hq` route, no code change), and the Object feature was deleted from the Developer Center. A new development view appeared in Views Center only after a hard refresh (Cmd+Shift+R).
- Not verified: that an install would make the object creatable (we stopped before asking an admin).

## 11. Creating items and the Gen-1 list (Task 22, 2026-11-19)
- **`create_item(board_id, item_name, column_values: JSON!)`:** `column_values` is a JSON **string** keyed by column ID, the same write formats as §8. The IDs come from `boards(ids) { columns { id title } }`, matched by title.
  - The board comes from the saved board config: `createGym`/`recruit` don't get a board ID from the screen.
- **createGym:** `{ "<Type>": { "labels": ["Rock"] } }`. The Gyms `Type` dropdown has all 18 labels and `label_limit_count: 1`, so no `create_labels_if_missing` is needed.
- **recruit:** ONE `create_item` writes the species (number, types, sprite, stats), `Level` 1, `Energy` 3, `Status` "Recruited" and the gym link `{ "item_ids": [<gymId>] }`.
  - The mutation asks for the Pokémon fields **in its response** (`create_item(…) { id name column_values {…} }`), so the new item comes back without a second query.
  - The two-way connect adds it to the gym's `Pokemon` column by itself.
  - The Pokémon board's `Types` dropdown allows 2 labels; `Status` already has "Recruited".
- **PokéAPI `type/{name}`** returns both the type's `damage_relations` (`double_damage_to` / `half_damage_to` / `no_damage_to` → 2 / 0.5 / 0) and `pokemon[]` (`{ slot, pokemon: { name, url } }`, slot 1 = primary type).
  - The 18 type lists cover **all 151** Gen-1 Pokémon (67 have two types). So `getTypeChart` and `listGen1` share 18 requests instead of 151+.
  - Ids above 151 (later generations, alternate forms like `rotom-heat` 10008) are skipped.
  - Names are the slug capitalized, except `nidoran-f` → "Nidoran♀", `nidoran-m` → "Nidoran♂", `mr-mime` → "Mr. Mime", `farfetchd` → "Farfetch’d" (the English names `pokemon-species` gives).
  - The sprite is `…/sprites/pokemon/{n}.png`, the same URL as `front_default`.
- **Cache:** memory (one Promise per page load), then global SDK storage (`pokeapi:typeChart:v1`, `pokeapi:gen1:v1`), then PokéAPI.
  - Checked in monday: the first visit to Recruit makes 18 `type/…` requests; after a reload, none.

## 12. Deploying to monday code (Task 23, 2026-11-19)
- **`mapps code:push --client-side --directoryPath dist`** (run by `.github/workflows/deploy.yml`) uploads to the draft version's CDN.
  - The URL looks like `https://v<hash>.cdn2.monday.app`, and the log prints it.
  - `mapps code:status` says "No deployment found": it only covers server deployments, not the client-side CDN.
- **Vite `base: './'`** makes the asset paths relative (`./assets/…`), so `index.html` works at the CDN root.
- **Pointing a feature at the CDN:** `mapps app-features:build --buildType monday_code_cdn --customUrl "#/board-view"`.
  - The manifest then stores `build: { url: "#/board-view", kind: "view" }`.
  - The Developer Center shows the full URL: `<cdn URL>/#/board-view`.
  - monday still appends its query after the hash, as with the tunnel (§1).
- **Cache:** after the switch, a view that had been opened while the tunnel was down kept showing the ngrok error page until the browser was quit and reopened. The setting itself was already correct.
- **Checked by Eden with the tunnel and `npm run dev` stopped:** item view + Talk, board view, widget, Spar/Transfer, the Status dialog and Gym HQ View all work.
- Status & Evolve has no URL of its own: it opens the Dialog feature.

## 13. The server on monday code (Phase 2, Task 1, 2026-11-22)

`server/` is pushed with `mapps code:push -d server -a <APP_ID> -i <APP_VERSION_ID>` (CLI 4.11.1).

- **Upload:** the CLI zips the folder using `server/.mappsignore`. The archive held exactly `.mappsignore`, `.mondaycoderc`, `dist/index.js` (+ map), `package.json` and `package-lock.json`, so `dist/` **is** uploaded when `.mappsignore` doesn't list it.
  - The CLI leaves `code.tar.gz` behind in the pushed folder. It is in `.mappsignore` and `.gitignore`.
- **Runtime version:** `.mondaycoderc` `RUNTIME_VERSION` must be a full version. The CLI checks `^(18|20|22)\.\d+\.\d+$`, so `"22.x.x"` is rejected before upload.
  - monday code also **blocks unpatched runtimes**. `22.14.0` failed with "Deployment blocked: … vulnerable to CVE-2026-111497 … Update Node.js to 22.23.4 or higher (Node 22)". We use `22.23.4`.
- **Env and secrets need a server release first.** Before any server deployment, `mapps code:env` / `code:secret` fail with `No monday code release found for this app` (HTTP 400).
  - The client-side CDN push doesn't count.
  - Without `--verbose` the CLI prints nothing, only a failed exit code.
  - A **failed** deployment is enough to create the release.
  - Order for a new app: push → set env/secrets → push again.
- **A deployment only succeeds if the container listens on port 8080.** "In order for the deployment to be successful, the container should be up and listen on port 8080." A server that exits at boot (missing config) fails the deployment, and the push prints the container's stdout.
- **CLI noise:** after "Asset uploaded successfully" the CLI often prints "Unexpected error occurred while communicating with the remote server". The deployment still continues. Check it with `mapps code:status -i <APP_VERSION_ID>` (`building-infra` → `successful` / `failed`, with `errorMessage`). The first deployment takes a few minutes.
- **URL:** `https://<hash>-service-<number>-<hash>.us.monday.app` (`us` is the region), shown by `code:status` once the deployment succeeds.
- **Config through the SDK:** `EnvironmentVariablesManager` / `SecretsManager` (apps-sdk 3.3.2):
  - In the cloud they read the file monday code mounts at `/secrets/$SECRET_NAME`.
  - Locally (`K_SERVICE` unset) they return `process.env`, which `tsx --env-file=.env` fills. So the same code runs in both places.
  - `PORT` is not part of `code:env`; the runtime sets it.
- **Logs:** each `Logger.info(JSON)` line shows in `mapps code:logs -i <APP_VERSION_ID> -t console -s live` as `[console]{…}`, and in Developer Center → **Host on monday** → logs. One `/health` request = one line: `{"kind":"http","traceId":"…","method":"GET","path":"/health","status":200,"durationMs":1}`.
  - The push's deploy log printed lines of literally `null` before our boot error. They are not our events, which arrive as normal JSON.
- **Through the tunnel:** Vite on 5173 forwards only `/api`, `/oauth` and `/telegram` to the server, so `/health` through the tunnel reaches Vite, not the server. Check it at `http://localhost:8080/health`; tunnel checks start with the first `/api` route (Task 3).

## 14. sessionToken and Document DB on monday code (Phase 2, Task 3, 2026-11-22)

**sessionToken**, read from the Gym HQ View iframe URL (`sessionToken=` after the hash) and decoded without printing it:
- Header `{ alg: "HS256" }`. The payload has only `dat` and `exp` (no `iat`).
- `dat` keys: `client_id`, `user_id`, `account_id`, `slug`, `app_id`, `app_version_id`, `install_id`, `is_admin`, `is_view_only`, `is_guest`, `user_kind`.
- **It is signed with the app's Client Secret.** Sent as `Authorization: Bearer <token>` from the iframe to the deployed server's `GET /api/me`, which verifies with `MONDAY_CLIENT_SECRET` (HS256 only), it returned `200 { connected: false, boardsKnown: false, telegram: { linked: false } }`. The Phase 2 spec says "signing secret", but the Signing Secret is not what signs it.
- CORS worked from the iframe origin. Without a token, `/api/me` → `401`.

**Document DB:**
- monday code injects `MNDY_MONGODB_CONNECTION_STRING` by itself. Nothing had to be enabled in the Developer Center.
- The **first** deployment that connected failed. The push log showed only `null` lines: the SDK Logger's output is not rendered there, which is why boot failures now also go to stderr as `[boot] …`. The next push, with no config change, succeeded. Most likely the database was being created on the first connection (unconfirmed).
- **It is Firestore with MongoDB compatibility.** `getIndexes()` returns `firestoreOptions: { multikey: true }`.
  - `db.getCollectionNames()` returns `[]` while no documents exist, even though the indexes were created.
  - There is no `_id_` index in the list.
- **Unique indexes are supported.** `links` has `{ name: "userId_1", key: { userId: 1 }, unique: true }`, created by `ensureIndexes` at boot. So `links` keeps `_id = chatId` with a unique `userId`.
- Inspect it with `mapps database:connection-string -a <APP_ID>` (temporary and read-only), then `mongosh "<string>"` or Compass. Never commit or share the string.

## 15. OAuth 2.1 with PKCE against monday (Phase 2, Task 4, 2026-11-22)

Tested on the deployed server, started from the Gym HQ View iframe console (`POST /api/oauth/start` with the sessionToken), then monday's consent screen, then `GET /oauth/callback`.

- **Authorize URL:** the same as the legacy flow, `https://auth.monday.com/oauth2/authorize`, with `client_id`, `redirect_uri`, `state`, `code_challenge` and `code_challenge_method=S256`. A draft, uninstalled app's consent screen works.
- **The new flow must be switched on per app version.** In the Developer Center, under OAuth & Permissions, turn on "New OAuth Flow" ("Active for me" while testing; it goes live when the version is promoted).
  - With the switch off, the code is a legacy code, and the new token endpoint answers `invalid_grant`. That is what we got first.
- **Token endpoint:** `POST https://auth.monday.com/oauth_ms/oauth/token` with a **JSON** body, as in every example in the migration docs.
  - The first try sent a form-encoded body. Both the switch and the JSON body were fixed before the successful run, so which one mattered is not isolated.
  - Body fields: `grant_type`, `client_id`, `client_secret`, `code`, `redirect_uri` (the same as the authorize request) and `code_verifier`.
- **The response** has `access_token` and `refresh_token`, and no `expires_in`. The access token is a JWT with `exp`, which `tokenFromResponse` reads. Refresh tokens rotate and are single-use.
- **Document DB (Firestore)** handles `findOneAndDelete` with an `expiresAt > now` filter. The single-use OAuth `state` works.
- The callback's `me()` check with the new token matched the user who started, and the token was stored in Secure Storage as `monday-token:<userId>`.

## 16. The Connect tab and openLinkInTab (Phase 2, Task 5, 2026-11-22)

- **`monday.execute('openLinkInTab', { url })` opens the tab but never resolves** (seen from the Gym HQ View iframe). Awaiting it left the Connect tab stuck: the button stayed disabled, the text stayed "Not connected yet", and polling never started. The OAuth itself succeeded in the other tab.
  - So the app fires it without awaiting, and only logs a failure.
  - `src/api/monday/index.test.ts` fakes an `openLinkInTab` that never answers.
- **Polling vs. a tab in the background:** browsers slow down timers in tabs and frames that are not in front. So the Connect tab also asks the server right away on `focus` / `visibilitychange`, even after its 2-minute polling window has ended.
- **End to end through the tunnel**, with the app from the worktree on Vite :5173 and the server from the main checkout on :8080. `/api` and `/oauth` reach the server through the Vite proxy, and `SERVER_BASE_URL` = the tunnel URL.
  - The user was created at 14:56:31.163 by the OAuth callback.
  - The boards were sent by the tab at 14:56:31.462, 0.3 s later, with no refresh.
  - The token was in the local Secure Storage file under `monday-token:<userId>`.

## 17. The queue and a battle on monday code (Phase 2, Task 7, 2026-11-23)

Tested on the deployed draft version: `POST /api/battles` from the Gym HQ View iframe console (Cinnabar Gym vs Pewter Gym), then `GET /api/battles/<id>?turns=1` every second.

- **`/mndy-queue` gets our message as raw JSON, not a Pub/Sub envelope.** The body's keys were exactly `v, battleId, traceId`, and there was no `message.data` base64. `parseQueueBody` still accepts the envelope, which costs nothing.
- **It is Google Pub/Sub push underneath.** The request had:
  - `content-type: application/json` and `user-agent: APIs-Google`;
  - `x-goog-pubsub-delivery-attempt`, `x-goog-pubsub-message-id`, `x-goog-pubsub-subscription-name`, `x-goog-pubsub-publish-time`;
  - an `authorization` header (most likely Google's OIDC token). We don't check it; `?secret=` is what we validate.
  - The `queue` event now logs `deliveryAttempt` from that header; a value > 1 is a redelivery.
- **Timing:** the message arrived within about a second of the `202`. The whole run took 5.2 s (7 monday calls, 9 turns, 2 board changes), and monday code waits for our `200` until the work is done.
- **traceId:** the `queue` event carries the traceId of the `POST /api/battles` request, so `mapps code:logs -i <versionId> -t console -s live` shows both under one id. The `POST /mndy-queue` request itself gets its own `http` event with its own traceId.
- **Board:** only the two fighters that fought lost 1 Energy, and the winner's gym item got one update. Checked by Eden.
- **The client-side CDN caches `index.html` for a year.** It answers `cache-control: public, max-age=31536000` for `index.html` too. The iframe URL doesn't change between deploys (only the part after `#`), so a browser that has already loaded it keeps the old app.
  - Seen: Gym HQ View had no Connect tab although the CDN's `index.html` (last-modified that morning) had it. DevTools → Network → "Disable cache" + reload fixed it.
  - Quitting Chrome doesn't help, because the cache is on disk. This also explains the stale view in §12.
  - Users get new app code only when their cached copy is evicted. To be decided: how to make deploys reach them.

## 18. Linking a Telegram chat (Phase 2, Task 9, 2026-11-23)

Tested on the deployed draft version: Gym HQ → Connect → Connect Telegram, with the bot's webhook set to the cloud URL (`server/scripts/set-webhook.ts`).

- **`openLinkInTab` opens the `https://t.me/<bot>?start=<code>` page**, which then tries `tg://resolve?domain=<bot>&start=<code>`. Without the Telegram desktop app, Chrome logs "scheme does not have a registered handler" and the Start button does nothing.
  - Sending `/start <code>` to the bot by hand, from the phone or Telegram Web, does the same thing. Eden decided not to add a QR code or a copyable code to the Connect tab.
- The code (43 chars of base64url) fits Telegram's 64-char `start` parameter.
- The link code is single use and lives 10 minutes, so a code seen in the address bar, a screenshot or chat history is useless once it is used or expired.

## 19. Key-value Storage as the PokéAPI cache (Phase 2, Task 13, 2026-11-24)
- `new Storage(accessToken)` from `@mondaycom/apps-sdk` with the user's OAuth token works on monday code: `get` answers `{ success: true, value, version }`, and a missing key answers `value: null`.
- **Storage keeps strings.** An object passed to `set` comes back from `get` as the string `"[object Object]"` (`typeof value === 'string'`), with `success: true` and no error. So a cache that stores objects silently never hits. Store `JSON.stringify(...)` and `JSON.parse` on read.
- `set` takes `{ ttl }` in seconds; we use 30 days (2,592,000), the maximum.
- The server stores `{ v: value }` as JSON, so a cached `null` (a status move) is told apart from a missing key.
- Every wide event that touched the cache has `cache: { hits, misses }` and `cacheKeys` (up to 20). Storage errors become misses and show as `cacheErrors` / `cacheError`.

## 20. The scheduler and the live version (Phase 2, Task 14, 2026-11-25)
- `mapps app:promote` turned version 20263892 live. `mapps code:status --appVersionId 20263892` then shows two URLs: `url` (the version's own, `https://db207-service-…`, still serving) and **`liveUrl`** (`https://live1-service-…`). The scheduler calls the live deployment.
- `--region` is refused for this app ("Region parameter is not allowed for this app"): it only applies to multi-region apps. Leave it out.
- `scheduler:create` **prompts** for `--minBackoffDuration` even though it is optional. Pass it (we use 60 s), or the command waits for input.
- `scheduler:run` before the job exists fails with `404 … monday-code deployment not found for the requested app` (misleading: the job was missing).
- Job: `energy-regen`, `"0 * * * *"` (UTC), `--maxRetries 2 --minBackoffDuration 60 --timeout 240`, target `/mndy-cronjob/energy-regen` (POST).
- The scheduler is **Google Cloud Scheduler**. Header names on the request: `accept-encoding`, `authorization`, `content-length`, `forwarded`, `host`, `traceparent`, `user-agent`, `x-cloud-trace-context`, `x-cloudscheduler`, `x-cloudscheduler-jobname`, `x-cloudscheduler-scheduletime`, `x-forwarded-for`, `x-forwarded-proto`.
- First run (`scheduler:run`): cron event `hourKey 2026-11-25T07`, `users 1, boards 1, changed 3, skipped 0, failures []`, `mondayCalls 3`, about 4 s. The board got +1 on the three Pokémon below full.
- A new draft version gets its own URL: v2 (20745511) → `https://e5bfb-service-…`. So the bot webhook, the OAuth redirect URL, `SERVER_BASE_URL` and the CI `SERVER_URL` name one specific version's server.
- **Open:** the route is open (the hour marks cap it at +1 per board per hour). The `authorization` header is likely a Google OIDC token; checking it would lock the route.
