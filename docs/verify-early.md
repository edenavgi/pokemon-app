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
