// Every monday GraphQL query and mutation the game uses (API version 2026-10).
// Transport-free: the app sends them through SeamlessApiClient, the server with a user's token.
// Shapes of the answers: docs/verify-early.md §2–§11.

// The fields of one Pokémon item, shared by every query that reads Pokémon (→ toPokemon)
export const POKEMON_FIELDS = `
  id
  name
  column_values {
    text
    value
    column { title }
    ... on DropdownValue { values { label } }
    ... on StatusValue { label }
    ... on BoardRelationValue { linked_item_ids display_value }
    ... on MirrorValue { display_value }
  }
`

// Pokémon by item IDs (profile, rosters)
export const POKEMON_QUERY = `
  query ($itemIds: [ID!]) {
    items(ids: $itemIds, limit: 100) { ${POKEMON_FIELDS} }
  }
`

// Every Pokémon on the given boards (widget)
export const POKEMON_BOARD_QUERY = `
  query ($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      items_page(limit: 500) {
        cursor
        items { ${POKEMON_FIELDS} }
      }
    }
  }
`

// The fields of one gym item, shared by the board query and the single-gym query (→ toGym)
export const GYM_FIELDS = `
  id
  name
  column_values {
    text
    column { title }
    ... on DropdownValue { values { label } }
    ... on BoardRelationValue { linked_item_ids }
    ... on MirrorValue { display_value }
  }
`

export const GYMS_QUERY = `
  query ($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      items_page(limit: 500) {
        cursor
        items { ${GYM_FIELDS} }
      }
    }
  }
`

export const GYM_QUERY = `
  query ($gymId: ID!) {
    items(ids: [$gymId]) { ${GYM_FIELDS} }
  }
`

// The boards the user can pick in BoardSetup: most recently used first, real boards only
export const BOARDS_QUERY = `
  query {
    boards(limit: 100, order_by: used_at) {
      id
      name
      type
    }
  }
`

// Writes need column IDs, not titles: read each item's board and its columns first
export const ITEM_BOARDS_QUERY = `
  query ($itemIds: [ID!]) {
    items(ids: $itemIds, limit: 100) {
      id
      board { id columns { id title } }
    }
  }
`

// A board's columns, to translate titles → IDs before creating an item on it
export const BOARD_COLUMNS_QUERY = `
  query ($boardId: ID!) {
    boards(ids: [$boardId]) { columns { id title } }
  }
`

// `fields`: what to read back from the new item in the same request
export const createItemMutation = (fields: string) => `
  mutation ($boardId: ID!, $name: String!, $values: JSON!) {
    create_item(board_id: $boardId, item_name: $name, column_values: $values) { ${fields} }
  }
`

// Posts a message in the item's Updates tab (e.g. "Charmander evolved into Charmeleon")
export const CREATE_UPDATE_MUTATION = `
  mutation ($itemId: ID!, $body: String!) {
    create_update(item_id: $itemId, body: $body) { id }
  }
`

// monday AI (needs the AI:Consume scope and API 2026-10+)
export const RUN_PROMPT_MUTATION = `
  mutation ($prompt: String!, $config: RunPromptConfigInput) {
    run_prompt(prompt: $prompt, config: $config) {
      content
    }
  }
`

// Who the token belongs to (the server checks this after OAuth)
export const ME_QUERY = `
  query {
    me { id name account { id name } }
  }
`
