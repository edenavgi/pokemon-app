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

_TODO: record the context of the other features (board view, widget, Spar/Transfer, Status column, Gym HQ) as each one gets connected._

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
- _TODO: find the minimal set of scopes (least privilege) before anyone else installs the app — every checked scope is shown to the installing admin._

## 4. Resolving column IDs without hardcoding
Column IDs are account-specific and random (`numeric_mm96ne2j`, `lookup_mm96y2hj`…). They also change if a column is deleted and recreated (seen with the Gyms mirror: `lookup_mm962j39` → `lookup_mm96y2hj`).
→ Resolve once per board with `boards(ids:[…]) { columns { id title type } }` and match by **title + type**. Titles must therefore be unique per board (we deleted a duplicate `Status` for this reason).
_TODO (Task 4): implement and record the approach._

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
- English flavor text contains `\n` and `\f` → collapsed with `.replace(/\s+/g, " ")`.
- Cached in memory per page load as a `Promise` per dex number (concurrent calls share one request; failures are not cached).

## 7. SDK storage and the widget context (Task 16, 2026-11-18)
- `monday.storage.getItem(key)` → the value is at `res.data.value` (a string). The docs don't say what an unsaved key returns, so treat any falsy value as "not saved". `setItem(key, value)` reports `res.data.success`. Values are strings (6MB per key): store `JSON.stringify(cfg)`.
- **Global** storage (`monday.storage.*`) is scoped to account + app and shared by every feature instance. `monday.storage.instance.*` is per instance and resets on a new major version.
- The widget's connected boards (dashboard "connected boards") arrive in the context as `boardIds` and change live when boards are added or removed. Checked with one board (Gyms only → hint) and with two.
- A feature's **Custom URL** in Developer Center → View Setup is only kept once it is saved for the feature. An empty field on reload means the URL was never stored, and the widget renders blank.
