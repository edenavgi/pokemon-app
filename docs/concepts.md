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
