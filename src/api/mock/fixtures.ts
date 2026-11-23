import type {
  EvolutionInfo, Id, Move, PokeType, SpeciesDetail, Status, TypeChart,
} from '../GameApi'

// Real PokeAPI values, hardcoded once. The app never fetches anything.
const sprite = (dex: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`

type Raw = Omit<SpeciesDetail, 'spriteUrl'>
const RAW: Raw[] = [
  { dexNumber: 1, name: 'Bulbasaur', types: ['Grass', 'Poison'], hp: 45, attack: 49, defense: 49, speed: 45,
    flavorText: "A strange seed was planted on its back at birth. The plant sprouts and grows with this POKéMON." },
  { dexNumber: 2, name: 'Ivysaur', types: ['Grass', 'Poison'], hp: 60, attack: 62, defense: 63, speed: 60,
    flavorText: "When the bulb on its back grows large, it appears to lose the ability to stand on its hind legs." },
  { dexNumber: 3, name: 'Venusaur', types: ['Grass', 'Poison'], hp: 80, attack: 82, defense: 83, speed: 80,
    flavorText: "The plant blooms when it is absorbing solar energy. It stays on the move to seek sunlight." },
  { dexNumber: 4, name: 'Charmander', types: ['Fire'], hp: 39, attack: 52, defense: 43, speed: 65,
    flavorText: "Obviously prefers hot places. When it rains, steam is said to spout from the tip of its tail." },
  { dexNumber: 5, name: 'Charmeleon', types: ['Fire'], hp: 58, attack: 64, defense: 58, speed: 80,
    flavorText: "When it swings its burning tail, it elevates the temperature to unbearably high levels." },
  { dexNumber: 6, name: 'Charizard', types: ['Fire', 'Flying'], hp: 78, attack: 84, defense: 78, speed: 100,
    flavorText: "Spits fire that is hot enough to melt boulders. Known to cause forest fires unintentionally." },
  { dexNumber: 7, name: 'Squirtle', types: ['Water'], hp: 44, attack: 48, defense: 65, speed: 43,
    flavorText: "After birth, its back swells and hardens into a shell. Powerfully sprays foam from its mouth." },
  { dexNumber: 8, name: 'Wartortle', types: ['Water'], hp: 59, attack: 63, defense: 80, speed: 58,
    flavorText: "Often hides in water to stalk unwary prey. For swimming fast, it moves its ears to maintain balance." },
  { dexNumber: 9, name: 'Blastoise', types: ['Water'], hp: 79, attack: 83, defense: 100, speed: 78,
    flavorText: "A brutal POKéMON with pressurized water jets on its shell. They are used for high speed tackles." },
  { dexNumber: 25, name: 'Pikachu', types: ['Electric'], hp: 35, attack: 55, defense: 40, speed: 90,
    flavorText: "When several of these POKéMON gather, their electricity could build and cause lightning storms." },
  { dexNumber: 26, name: 'Raichu', types: ['Electric'], hp: 60, attack: 90, defense: 55, speed: 110,
    flavorText: "Its long tail serves as a ground to protect itself from its own high voltage power." },
  { dexNumber: 41, name: 'Zubat', types: ['Poison', 'Flying'], hp: 40, attack: 45, defense: 35, speed: 55,
    flavorText: "Forms colonies in perpetually dark places. Uses ultrasonic waves to identify and approach targets." },
  { dexNumber: 42, name: 'Golbat', types: ['Poison', 'Flying'], hp: 75, attack: 80, defense: 70, speed: 90,
    flavorText: "Once it strikes, it will not stop draining energy from the victim even if it gets too heavy to fly." },
  { dexNumber: 63, name: 'Abra', types: ['Psychic'], hp: 25, attack: 20, defense: 15, speed: 90,
    flavorText: "Using its ability to read minds, it will identify impending danger and TELEPORT to safety." },
  { dexNumber: 64, name: 'Kadabra', types: ['Psychic'], hp: 40, attack: 35, defense: 30, speed: 105,
    flavorText: "It emits special alpha waves from its body that induce headaches just by being close by." },
  { dexNumber: 65, name: 'Alakazam', types: ['Psychic'], hp: 55, attack: 50, defense: 45, speed: 120,
    flavorText: "Its brain can out­ perform a super­ computer. Its intelligence quotient is said to be 5,000." },
  { dexNumber: 81, name: 'Magnemite', types: ['Electric', 'Steel'], hp: 25, attack: 35, defense: 70, speed: 45,
    flavorText: "Uses anti-gravity to stay suspended. Appears without warning and uses THUNDER WAVE and similar moves." },
  { dexNumber: 82, name: 'Magneton', types: ['Electric', 'Steel'], hp: 50, attack: 60, defense: 95, speed: 70,
    flavorText: "Formed by several MAGNEMITEs linked together. They frequently appear when sunspots flare up." },
  { dexNumber: 133, name: 'Eevee', types: ['Normal'], hp: 55, attack: 55, defense: 50, speed: 55,
    flavorText: "Its genetic code is irregular. It may mutate if it is exposed to radiation from element STONEs." },
  { dexNumber: 134, name: 'Vaporeon', types: ['Water'], hp: 130, attack: 65, defense: 60, speed: 65,
    flavorText: "Lives close to water. Its long tail is ridged with a fin which is often mistaken for a mermaid's." },
  { dexNumber: 135, name: 'Jolteon', types: ['Electric'], hp: 65, attack: 65, defense: 60, speed: 130,
    flavorText: "It accumulates negative ions in the atmosphere to blast out 10000- volt lightning bolts." },
  { dexNumber: 136, name: 'Flareon', types: ['Fire'], hp: 65, attack: 130, defense: 60, speed: 65,
    flavorText: "When storing thermal energy in its body, its temperature could soar to over 1600 degrees." },
]

export const SPECIES: SpeciesDetail[] = RAW.map((r) => ({ ...r, spriteUrl: sprite(r.dexNumber) }))

const lvl = (dexNumber: number, name: string, minLevel: number | null) =>
  ({ dexNumber, name, trigger: 'level-up' as const, minLevel })
const other = (dexNumber: number, name: string) =>
  ({ dexNumber, name, trigger: 'other' as const, minLevel: null })

export const EVOLUTIONS: Record<number, EvolutionInfo> = {
  1: { stage: 1, next: [lvl(2, 'Ivysaur', 16)] },
  2: { stage: 2, next: [lvl(3, 'Venusaur', 32)] },
  3: { stage: 3, next: [] },
  4: { stage: 1, next: [lvl(5, 'Charmeleon', 16)] },
  5: { stage: 2, next: [lvl(6, 'Charizard', 36)] },
  6: { stage: 3, next: [] },
  7: { stage: 1, next: [lvl(8, 'Wartortle', 16)] },
  8: { stage: 2, next: [lvl(9, 'Blastoise', 36)] },
  9: { stage: 3, next: [] },
  25: { stage: 1, next: [other(26, 'Raichu')] },
  26: { stage: 2, next: [] },
  41: { stage: 1, next: [lvl(42, 'Golbat', 22)] },
  42: { stage: 2, next: [lvl(169, 'Crobat', null)] }, // Crobat is outside Gen 1
  63: { stage: 1, next: [lvl(64, 'Kadabra', 16)] },
  64: { stage: 2, next: [other(65, 'Alakazam')] },
  65: { stage: 3, next: [] },
  81: { stage: 1, next: [lvl(82, 'Magneton', 30)] },
  82: { stage: 2, next: [] },
  133: { stage: 1, next: [other(134, 'Vaporeon'), other(135, 'Jolteon'), other(136, 'Flareon')] },
  134: { stage: 2, next: [] },
  135: { stage: 2, next: [] },
  136: { stage: 2, next: [] },
}

// Attacker type -> defender type -> multiplier. Missing = 1.
export const TYPE_CHART: TypeChart = {
  Normal: { Rock: 0.5, Steel: 0.5, Ghost: 0 },
  Fire: { Bug: 2, Steel: 2, Grass: 2, Ice: 2, Rock: 0.5, Fire: 0.5, Water: 0.5, Dragon: 0.5 },
  Water: { Ground: 2, Rock: 2, Fire: 2, Water: 0.5, Grass: 0.5, Dragon: 0.5 },
  Grass: { Ground: 2, Rock: 2, Water: 2, Flying: 0.5, Poison: 0.5, Bug: 0.5, Steel: 0.5, Fire: 0.5, Grass: 0.5, Dragon: 0.5 },
  Electric: { Flying: 2, Water: 2, Grass: 0.5, Electric: 0.5, Dragon: 0.5, Ground: 0 },
  Ice: { Flying: 2, Ground: 2, Grass: 2, Dragon: 2, Steel: 0.5, Fire: 0.5, Water: 0.5, Ice: 0.5 },
  Fighting: { Normal: 2, Rock: 2, Steel: 2, Ice: 2, Dark: 2, Flying: 0.5, Poison: 0.5, Bug: 0.5, Psychic: 0.5, Fairy: 0.5, Ghost: 0 },
  Poison: { Grass: 2, Fairy: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0 },
  Ground: { Poison: 2, Rock: 2, Steel: 2, Fire: 2, Electric: 2, Bug: 0.5, Grass: 0.5, Flying: 0 },
  Flying: { Fighting: 2, Bug: 2, Grass: 2, Rock: 0.5, Steel: 0.5, Electric: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Steel: 0.5, Psychic: 0.5, Dark: 0 },
  Bug: { Grass: 2, Psychic: 2, Dark: 2, Fighting: 0.5, Flying: 0.5, Poison: 0.5, Ghost: 0.5, Steel: 0.5, Fire: 0.5, Fairy: 0.5 },
  Rock: { Flying: 2, Bug: 2, Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Steel: 0.5 },
  Ghost: { Ghost: 2, Psychic: 2, Dark: 0.5, Normal: 0 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Ghost: 2, Psychic: 2, Fighting: 0.5, Dark: 0.5, Fairy: 0.5 },
  Steel: { Rock: 2, Ice: 2, Fairy: 2, Steel: 0.5, Fire: 0.5, Water: 0.5, Electric: 0.5 },
  Fairy: { Fighting: 2, Dragon: 2, Dark: 2, Poison: 0.5, Steel: 0.5, Fire: 0.5 },
}

export interface SeedGym { id: Id; name: string; type: PokeType }
export interface SeedPokemon {
  id: Id; dexNumber: number; level: number; energy: number; status: Status; gymId: Id | null
}

export const SEED_GYMS: SeedGym[] = [
  { id: 'g1', name: 'Cinnabar Gym', type: 'Fire' },
  { id: 'g2', name: 'Cerulean Gym', type: 'Water' },
  { id: 'g3', name: 'Celadon Gym', type: 'Grass' }, // full roster of 6
]

export const SEED_POKEMON: SeedPokemon[] = [
  { id: 'p1', dexNumber: 4, level: 5, energy: 3, status: 'Ready', gymId: 'g1' },
  { id: 'p2', dexNumber: 5, level: 18, energy: 2, status: 'Training', gymId: 'g1' },
  { id: 'p3', dexNumber: 7, level: 7, energy: 3, status: 'Ready', gymId: 'g2' },
  { id: 'p4', dexNumber: 8, level: 16, energy: 1, status: 'Resting', gymId: 'g2' },
  { id: 'p5', dexNumber: 1, level: 5, energy: 3, status: 'Ready', gymId: 'g3' },
  { id: 'p6', dexNumber: 2, level: 16, energy: 2, status: 'Training', gymId: 'g3' },
  { id: 'p7', dexNumber: 3, level: 36, energy: 3, status: 'Ready', gymId: 'g3' },
  { id: 'p8', dexNumber: 26, level: 10, energy: 3, status: 'Ready', gymId: 'g3' },
  { id: 'p9', dexNumber: 25, level: 12, energy: 3, status: 'Ready', gymId: 'g3' },
  { id: 'p10', dexNumber: 41, level: 8, energy: 2, status: 'Training', gymId: 'g3' },
  { id: 'p11', dexNumber: 42, level: 22, energy: 3, status: 'Ready', gymId: null }, // evolves out of Gen 1
  { id: 'p12', dexNumber: 81, level: 6, energy: 0, status: 'Resting', gymId: null }, // zero energy
  { id: 'p13', dexNumber: 63, level: 15, energy: 3, status: 'Recruited', gymId: null },
  { id: 'p14', dexNumber: 133, level: 1, energy: 3, status: 'Recruited', gymId: null }, // branching evolution
  { id: 'p15', dexNumber: 6, level: 36, energy: 3, status: 'Ready', gymId: null }, // fully evolved
]


// Damaging moves for the mock arena (the real server loads them from PokéAPI): Tackle + one move per type.
const TYPE_MOVES: Partial<Record<PokeType, Move>> = {
  Fire: { name: 'Ember', type: 'Fire', power: 40 },
  Water: { name: 'Water Gun', type: 'Water', power: 40 },
  Grass: { name: 'Vine Whip', type: 'Grass', power: 45 },
  Electric: { name: 'Thunder Shock', type: 'Electric', power: 40 },
  Poison: { name: 'Sludge', type: 'Poison', power: 65 },
  Flying: { name: 'Wing Attack', type: 'Flying', power: 60 },
  Psychic: { name: 'Confusion', type: 'Psychic', power: 50 },
  Steel: { name: 'Metal Claw', type: 'Steel', power: 50 },
}
const TACKLE: Move = { name: 'Tackle', type: 'Normal', power: 40 }
export const MOVESETS = new Map<number, Move[]>(
  SPECIES.map((s) => [s.dexNumber, [TACKLE, ...s.types.flatMap((t) => (TYPE_MOVES[t] ? [TYPE_MOVES[t]] : []))]]),
)
