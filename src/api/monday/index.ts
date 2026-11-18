import mondaySdk from "monday-sdk-js";
import type {
  AppContext, BoardConfig, EvolutionInfo, EvolutionTarget, GameApi, Gym, PokeType, Pokemon, PokemonPatch,
  SpeciesDetail, Status, ThemeName,
} from "../GameApi";
import { SeamlessApiClient } from "@mondaydotcomorg/api";

const monday = mondaySdk();

const client = new SeamlessApiClient("2026-10");

// The fields of one Pokémon item, shared by every query that reads Pokémon (→ toPokemon)
const POKEMON_FIELDS = `
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
`;

// Pokémon by item IDs (profile, rosters)
const POKEMON_QUERY = `
  query ($itemIds: [ID!]) {
    items(ids: $itemIds, limit: 100) { ${POKEMON_FIELDS} }
  }
`;

// Every Pokémon on the given boards (widget)
const POKEMON_BOARD_QUERY = `
  query ($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      items_page(limit: 500) {
        cursor
        items { ${POKEMON_FIELDS} }
      }
    }
  }
`;

const TALK_MUTATION = `
  mutation ($prompt: String!, $config: RunPromptConfigInput) {
    run_prompt(prompt: $prompt, config: $config) {
      content
    }
  }
`;


const GYMS_QUERY = `
  query ($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      items_page(limit: 500) {
        cursor
        items {
          id
          name
          column_values {
            text
            column { title }
            ... on DropdownValue { values { label } }
            ... on BoardRelationValue { linked_item_ids }
            ... on MirrorValue { display_value }
          }
        }
      }
    }
  }
`;

// The boards the user can pick in BoardSetup: most recently used first, real boards only
const BOARDS_QUERY = `
  query {
    boards(limit: 100, order_by: used_at) {
      id
      name
      type
    }
  }
`;

// Posts a message in the item's Updates tab (e.g. "Charmander evolved into Charmeleon")
const CREATE_UPDATE_MUTATION = `
  mutation ($itemId: ID!, $body: String!) {
    create_update(item_id: $itemId, body: $body) { id }
  }
`;

// Global SDK storage key (shared by every widget/view of the app in this account)
const BOARD_CONFIG_KEY = "boardConfig";

// The shape of one column value, as we saw it in the console
interface ColumnValue {
  text: string | null;
  value: string | null;
  column: { title: string };
  values?: { label: string }[];  // dropdown (Types)
  label?: string;                // status
  linked_item_ids?: string[];    // connect boards (Gym)
  display_value?: string;        // connect boards / mirror
}
interface PokemonItem {
  id: string;
  name: string;
  column_values: ColumnValue[];
}

// Returns col(title): the column value with that title, or a clear error if the board lacks it
function columnReader(columnValues: ColumnValue[], board: string) {
  const byTitle = new Map(columnValues.map((cv) => [cv.column.title, cv]));
  return (title: string): ColumnValue => {
    const cv = byTitle.get(title);
    if (!cv) throw new Error(`${board} board: missing column "${title}"`);
    return cv;
  };
}

function toPokemon(item: PokemonItem): Pokemon {
  const col = columnReader(item.column_values, "Pokemon");
  const num = (title: string) => Number(col(title).text) || 0;

  const sprite = col("Sprite").value;
  const gym = col("Gym");
  const gymId = gym.linked_item_ids?.[0];

  return {
    id: item.id,
    name: item.name,
    dexNumber: num("Pokédex number"),
    types: (col("Types").values ?? []).map((v) => v.label as PokeType),
    spriteUrl: sprite ? JSON.parse(sprite).url : "",
    hp: num("HP"),
    attack: num("Attack"),
    defense: num("Defense"),
    speed: num("Speed"),
    level: num("Level"),
    energy: num("Energy"),
    status: col("Status").label as Status,
    gym: gymId
      ? {
          id: gymId,
          name: gym.display_value ?? "",
          type: (col("Gym type (mirror)").display_value || null) as PokeType | null,
        }
      : null,
  };
}

async function fetchPokemon(itemIds: string[]): Promise<Pokemon[]> {
  if (itemIds.length === 0) return []; // nothing to ask for
  if (itemIds.length > 100) console.warn(`[fetchPokemon] ${itemIds.length} ids; only the first 100 are fetched`);
  const res = await client.request<{ data: { data: { items: PokemonItem[] } } }>(
    POKEMON_QUERY,
    { itemIds },
  );
  return res.data.data.items.map(toPokemon);
}

// All items of the given boards from a boards → items_page query (one page of up to 500 per board)
async function fetchBoardItems<T>(query: string, boardIds: string[] | undefined, label: string): Promise<T[]> {
  const res = await client.request<{
    data: { data: { boards: { items_page: { cursor: string | null; items: T[] } }[] } };
  }>(query, { boardIds });
  const pages = res.data.data.boards.map((b) => b.items_page);
  if (pages.some((p) => p.cursor)) console.warn(`[${label}] a board has more than 500 items; only the first 500 are used`);
  return pages.flatMap((p) => p.items);
}

interface GymItem {
  id: string;
  name: string;
  column_values: ColumnValue[];
}

// "5, 7" → [5, 7]; "" → []
function parseMirroredNumbers(text?: string): number[] {
  if (!text) return [];
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter(Number.isFinite);
}

const rosterIds = (gym: GymItem) =>
  columnReader(gym.column_values, "Gyms")("Pokemon").linked_item_ids ?? [];

function toGym(item: GymItem, pokemonById: Map<string, Pokemon>): Gym {
  const col = columnReader(item.column_values, "Gyms");
  return {
    id: item.id,
    name: item.name,
    type: (col("Type").values?.[0]?.label ?? null) as PokeType | null,
    roster: rosterIds(item)
      .map((id) => pokemonById.get(id))
      .filter((p): p is Pokemon => p !== undefined),
    mirroredLevels: parseMirroredNumbers(col("Level (mirror)").display_value),
  };
}

// ---------- Writing to the board ----------

// Writes need column IDs, not titles: read each item's board and its columns first
const ITEM_BOARDS_QUERY = `
  query ($itemIds: [ID!]) {
    items(ids: $itemIds, limit: 100) {
      id
      board { id columns { id title } }
    }
  }
`;

interface ItemBoard {
  id: string;
  board: { id: string; columns: { id: string; title: string }[] };
}

type ColumnIdOf = (title: string) => string;

// Writes column values to many items in ONE request: one aliased change_multiple_column_values per item.
// `build(itemId, col)` returns { columnId: value } for that item; col("Level") gives the column's ID.
async function writeItems(
  itemIds: string[],
  build: (itemId: string, col: ColumnIdOf) => Record<string, unknown>,
): Promise<void> {
  if (itemIds.length === 0) return;
  if (itemIds.length > 100) throw new Error("Cannot update more than 100 items at once");

  const res = await client.request<{ data: { data: { items: ItemBoard[] } } }>(ITEM_BOARDS_QUERY, { itemIds });
  const itemById = new Map(res.data.data.items.map((i) => [i.id, i]));

  // Validate everything (items exist, columns exist) BEFORE the first write
  const writes = itemIds.map((itemId) => {
    const item = itemById.get(itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    const idByTitle = new Map(item.board.columns.map((c) => [c.title, c.id]));
    const col: ColumnIdOf = (title) => {
      const id = idByTitle.get(title);
      if (!id) throw new Error(`Pokemon board: missing column "${title}"`);
      return id;
    };
    return { boardId: item.board.id, itemId, values: build(itemId, col) };
  });

  // mutation ($board0: ID!, $item0: ID!, $values0: JSON!, $board1: …) { w0: change_…(…) { id } w1: … }
  const declarations = writes.map((_, i) => `$board${i}: ID!, $item${i}: ID!, $values${i}: JSON!`).join(", ");
  const fields = writes
    .map((_, i) => `w${i}: change_multiple_column_values(board_id: $board${i}, item_id: $item${i}, column_values: $values${i}) { id }`)
    .join("\n    ");
  const variables = Object.fromEntries(
    writes.flatMap((w, i) => [
      [`board${i}`, w.boardId],
      [`item${i}`, w.itemId],
      [`values${i}`, JSON.stringify(w.values)], // column_values is a JSON *string*
    ]),
  );
  await client.request(`mutation (${declarations}) {\n    ${fields}\n  }`, variables);
}

// Number columns: patch field → column title
const NUMBER_COLUMNS = {
  dexNumber: "Pokédex number", hp: "HP", attack: "Attack", defense: "Defense",
  speed: "Speed", level: "Level", energy: "Energy",
} as const;

// A PokemonPatch → { columnId: value } in the format each column type expects when WRITING
function patchToColumnValues(patch: PokemonPatch, col: ColumnIdOf): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, title] of Object.entries(NUMBER_COLUMNS) as [keyof typeof NUMBER_COLUMNS, string][]) {
    const n = patch[field];
    if (n !== undefined) values[col(title)] = String(n); // numbers: "5"
  }
  if (patch.status !== undefined) values[col("Status")] = { label: patch.status }; // status: by label, never index
  if (patch.types !== undefined) values[col("Types")] = { labels: patch.types }; // dropdown: by labels
  if (patch.spriteUrl !== undefined) values[col("Sprite")] = { url: patch.spriteUrl, text: patch.name ?? "sprite" }; // link
  if (patch.name !== undefined) values.name = patch.name; // the item name (used by evolution, Task 20)
  return values;
}

// ---------- PokéAPI ----------
const POKEAPI = "https://pokeapi.co/api/v2";

// The parts of the PokéAPI responses we use (see pokeapi.co/docs/v2)
interface PokeApiPokemon {
  types: { type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
  sprites: { front_default: string | null };
}
interface PokeApiSpecies {
  names: { name: string; language: { name: string } }[];
  flavor_text_entries: { flavor_text: string; language: { name: string } }[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PokéAPI ${res.status}: ${url}`);
  return (await res.json()) as T;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function loadSpecies(dexNumber: number): Promise<SpeciesDetail> {
  const [pokemon, species] = await Promise.all([
    fetchJson<PokeApiPokemon>(`${POKEAPI}/pokemon/${dexNumber}`),
    fetchJson<PokeApiSpecies>(`${POKEAPI}/pokemon-species/${dexNumber}`),
  ]);
  const stat = (name: string) =>
    pokemon.stats.find((s) => s.stat.name === name)?.base_stat ?? 0;
  const englishName = species.names.find((n) => n.language.name === "en");
  const englishFlavor = species.flavor_text_entries.find((f) => f.language.name === "en");

  return {
    dexNumber,
    name: englishName?.name ?? `#${dexNumber}`,
    types: pokemon.types.map((t) => capitalize(t.type.name) as PokeType),
    spriteUrl: pokemon.sprites.front_default ?? "",
    hp: stat("hp"),
    attack: stat("attack"),
    defense: stat("defense"),
    speed: stat("speed"),
    flavorText: englishFlavor ? englishFlavor.flavor_text.replace(/\s+/g, " ").trim() : "",
  };
}

// Gen-1 data never changes: fetch each species once per page load
const speciesCache = new Map<number, Promise<SpeciesDetail>>();

// ---------- Evolution chains (PokéAPI) ----------

// One node of evolution-chain/{id}: a species and the forms it evolves into (a tree)
interface ChainNode {
  species: { name: string; url: string };
  evolution_details: { trigger: { name: string }; min_level: number | null }[];
  evolves_to: ChainNode[];
}

// ".../pokemon-species/5/" → 5
const dexFromUrl = (url: string) => Number(url.split("/").filter(Boolean).pop());

// The path from the chain's root to `dex`: [charmander, charmeleon] for 5
function pathTo(node: ChainNode, dex: number, path: ChainNode[] = []): ChainNode[] | null {
  const here = [...path, node];
  if (dexFromUrl(node.species.url) === dex) return here;
  for (const child of node.evolves_to) {
    const found = pathTo(child, dex, here);
    if (found) return found;
  }
  return null;
}

// A next form → EvolutionTarget. "level-up" only when some game version gives a min_level;
// friendship, stones and trades all count as "other".
function toTarget(node: ChainNode): EvolutionTarget {
  const byLevel = node.evolution_details.find((d) => d.trigger.name === "level-up" && d.min_level !== null);
  return {
    dexNumber: dexFromUrl(node.species.url),
    name: capitalize(node.species.name),
    trigger: byLevel ? "level-up" : "other",
    minLevel: byLevel?.min_level ?? null,
  };
}

// Several Pokémon share one chain (Charmander, Charmeleon, Charizard) → fetch each chain once
const chainCache = new Map<string, Promise<{ chain: ChainNode }>>();
const evolutionCache = new Map<number, Promise<EvolutionInfo>>();

function cachedChain(url: string) {
  let cached = chainCache.get(url);
  if (!cached) {
    cached = fetchJson<{ chain: ChainNode }>(url);
    chainCache.set(url, cached);
    cached.catch(() => chainCache.delete(url));
  }
  return cached;
}

async function loadEvolution(dexNumber: number): Promise<EvolutionInfo> {
  const species = await fetchJson<{ evolution_chain: { url: string } }>(`${POKEAPI}/pokemon-species/${dexNumber}`);
  const { chain } = await cachedChain(species.evolution_chain.url);
  const path = pathTo(chain, dexNumber);
  if (!path) throw new Error(`#${dexNumber} is not in its own evolution chain`);
  // Stage counts Gen-1 forms only: Pichu (#172, Gen 2) doesn't make Pikachu stage 2
  const gen1Steps = path.filter((n) => dexFromUrl(n.species.url) <= 151).length;
  const stage = Math.min(Math.max(gen1Steps, 1), 3) as 1 | 2 | 3;
  // `next` is NOT filtered to Gen 1, so evolutionCheck can say "outside Gen 1" (Golbat → Crobat)
  return { stage, next: path[path.length - 1].evolves_to.map(toTarget) };
}
// Placeholder for methods we haven't implemented yet
function notYet(name: string): never {
  throw new Error(`${name}: not implemented yet`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAppContext(data: any): AppContext {
  return {
    theme: data.theme as ThemeName,
    boardId: data.boardId != null ? String(data.boardId) : undefined,
    itemId: data.itemId != null ? String(data.itemId) : undefined,
    columnId: data.columnId != null ? String(data.columnId) : undefined,
    selectedItemIds: data.selectedPulsesIds?.map(String),
    widgetBoardIds: data.boardIds?.map(String),
  };
}

export function createMondayGameApi(): GameApi {
  const api: GameApi = {
    async getContext(): Promise<AppContext> {
      const res = await monday.get("context");
      return toAppContext(res.data);
    },

    onContextChange: (cb) =>
      monday.listen("context", (res) => cb(toAppContext(res.data))),
    onItemChanged: (itemId, cb) =>
      monday.listen("events", (res) => {
        const { itemIds } = res.data as { itemIds?: number[] };
        if (itemIds?.map(String).includes(itemId)) cb();
      }),
    listBoards: async () => {
      const res = await client.request<{
        data: { data: { boards: { id: string; name: string; type: string }[] } };
      }>(BOARDS_QUERY);
      const boards = res.data.data.boards;
      if (boards.length === 100) console.warn("[listBoards] showing only the 100 most recently used boards");
      // skip docs, subitem boards and custom objects
      return boards.filter((b) => b.type === "board").map(({ id, name }) => ({ id, name }));
    },
    getBoardConfig: async () => {
      const res = await monday.storage.getItem(BOARD_CONFIG_KEY);
      const raw = res.data?.value;
      if (!raw) return null; // never saved
      try {
        return JSON.parse(raw) as BoardConfig;
      } catch {
        return null; // corrupt value → ask the user again
      }
    },
    setBoardConfig: async (cfg) => {
      const res = await monday.storage.setItem(BOARD_CONFIG_KEY, JSON.stringify(cfg));
      if ((res.data as { success?: boolean } | undefined)?.success === false) {
        throw new Error("Could not save the board settings");
      }
    },
    getPokemon: async (itemId) => {
      const [pokemon] = await fetchPokemon([itemId]);
      if (!pokemon) throw new Error(`Pokémon item ${itemId} not found`);
      return pokemon;
    },
    getPokemonMany: (itemIds) => fetchPokemon(itemIds),
    listPokemon: async (opts) => {
      const items = await fetchBoardItems<PokemonItem>(POKEMON_BOARD_QUERY, opts?.boardIds, "listPokemon");
      // gymId/status are filtered here (client side); no screen passes them yet
      return items
        .map(toPokemon)
        .filter((p) => (!opts?.gymId || p.gym?.id === opts.gymId) && (!opts?.status || p.status === opts.status));
    },
    listGyms: async (opts) => {
      const gymItems = await fetchBoardItems<GymItem>(GYMS_QUERY, opts?.boardIds, "listGyms");

      // ONE query for every Pokémon of every gym
      const allIds = [...new Set(gymItems.flatMap(rosterIds))];
      const pokemonById = new Map((await fetchPokemon(allIds)).map((p) => [p.id, p]));

      return gymItems.map((g) => toGym(g, pokemonById));
    },
    getGym: () => notYet("getGym"),
    createGym: () => notYet("createGym"),
    recruit: () => notYet("recruit"),
    updatePokemon: async (patches) => {
      const patchById = new Map(patches.map((p) => [p.id, p.patch]));
      await writeItems([...patchById.keys()], (itemId, col) => patchToColumnValues(patchById.get(itemId)!, col));
    },
    // The Gym connect column: { item_ids: [gymId] }. Two-way connect updates the Gyms board by itself.
    setGym: (pokemonIds, gymId) =>
      writeItems([...new Set(pokemonIds)], (_, col) => ({ [col("Gym")]: { item_ids: [Number(gymId)] } })),
    postUpdate: async (itemId, body) => {
      await client.request(CREATE_UPDATE_MUTATION, { itemId, body });
    },
    // A toast inside monday (green / red / blue). Fire-and-forget: the contract returns void.
    notify: (message, type) => {
      monday
        .execute("notice", { message, type, timeout: 5000 })
        .catch((e: unknown) => console.warn("[notify] monday notice failed", e));
    },
    // Closes the window monday opened for this feature (e.g. "Transfer to gym").
    closeFeature: () => {
      monday
        .execute("closeAppFeatureModal")
        .catch((e: unknown) => console.warn("[closeFeature] could not close the feature window", e));
    },
    listGen1: () => notYet("listGen1"),
    getSpecies: (dexNumber) => {
      let cached = speciesCache.get(dexNumber);
      if (!cached) {
        cached = loadSpecies(dexNumber);
        speciesCache.set(dexNumber, cached);
        cached.catch(() => speciesCache.delete(dexNumber)); // don't keep failures
      }
      return cached;
    },
    getEvolution: (dexNumber) => {
      let cached = evolutionCache.get(dexNumber);
      if (!cached) {
        cached = loadEvolution(dexNumber);
        evolutionCache.set(dexNumber, cached);
        cached.catch(() => evolutionCache.delete(dexNumber)); // don't keep failures
      }
      return cached;
    },
    getTypeChart: () => notYet("getTypeChart"),
       talk: async ({ system, user }) => {
      try {
        const res = await client.request<{ data: { data: { run_prompt: { content: string } } } }>(
          TALK_MUTATION,
          {
            prompt: user,
            config: { model: "MONDAY_FAST", system_prompt: system, temperature: 0.8, max_tokens: 60 },
          },
        );
        return res.data.data.run_prompt.content;
      } catch (e) {
        console.warn("[talk] run_prompt failed", (e as { response?: unknown }).response ?? e);
        throw e;
      }
    },
   };
  return api;
}
