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

### Open question (needed for the widget's average level)
With **several** linked Pokémon, what does `Level (mirror).display_value` look like (separator? order? empty values?), and is parsing it reliable — or should the average come from the linked items' own `Level` instead?
_Experiment: link Squirtle to Cinnabar too, set its Level to 4, rerun the query, record the result here, then revert._

## 3. SeamlessApiClient from the iframe
_TODO (Task 4)._

## 4. Resolving column IDs without hardcoding
Column IDs are account-specific and random (`numeric_mm96ne2j`, `lookup_mm96y2hj`…). They also change if a column is deleted and recreated (seen with the Gyms mirror: `lookup_mm962j39` → `lookup_mm96y2hj`).
→ Resolve once per board with `boards(ids:[…]) { columns { id title type } }` and match by **title + type**. Titles must therefore be unique per board (we deleted a duplicate `Status` for this reason).
_TODO (Task 4): implement and record the approach._

## 5. `run_prompt` from the browser
_TODO (Task 4)._
