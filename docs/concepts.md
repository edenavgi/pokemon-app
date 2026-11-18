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
