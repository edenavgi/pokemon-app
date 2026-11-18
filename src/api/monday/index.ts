import mondaySdk from "monday-sdk-js";
import type { AppContext, SpeciesDetail, GameApi, PokeType, Pokemon, Status, ThemeName } from "../GameApi";import { SeamlessApiClient } from "@mondaydotcomorg/api";
const monday = mondaySdk();

const client = new SeamlessApiClient("2026-10");

const POKEMON_QUERY = `
  query ($itemId: ID!) {
    items(ids: [$itemId]) {
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

function toPokemon(item: PokemonItem): Pokemon {
  const byTitle = new Map(item.column_values.map((cv) => [cv.column.title, cv]));
  const col = (title: string): ColumnValue => {
    const cv = byTitle.get(title);
    if (!cv) throw new Error(`Pokemon board: missing column "${title}"`);
    return cv;
  };
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
    listBoards: () => notYet("listBoards"),
    getBoardConfig: () => notYet("getBoardConfig"),
    setBoardConfig: () => notYet("setBoardConfig"),
         getPokemon: async (itemId) => {
      const res = await client.request<{ data: { data: { items: PokemonItem[] } } }>(
        POKEMON_QUERY,
        { itemId },
      );
      const item = res.data.data.items[0];
      if (!item) throw new Error(`Pokémon item ${itemId} not found`);
      return toPokemon(item);
    },
    getPokemonMany: () => notYet("getPokemonMany"),
    listPokemon: () => notYet("listPokemon"),
    listGyms: () => notYet("listGyms"),
    getGym: () => notYet("getGym"),
    createGym: () => notYet("createGym"),
    recruit: () => notYet("recruit"),
    updatePokemon: () => notYet("updatePokemon"),
    setGym: () => notYet("setGym"),
    postUpdate: () => notYet("postUpdate"),
    notify: () => notYet("notify"),
    closeFeature: () => notYet("closeFeature"),
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
    getEvolution: () => notYet("getEvolution"),
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
    }, };
  return api;
}
