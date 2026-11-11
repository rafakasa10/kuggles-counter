/** Test phrases for the accuracy runs. `expect` uses only words in the Vosk grammar. */
export interface Phrase {
  readonly id: string;
  /** What the player reads out (natural punctuation for pauses). */
  readonly say: string;
  readonly expect: string;
  readonly tag: "darts" | "homophone" | "special" | "total" | "command";
}

export const PHRASES: readonly Phrase[] = [
  {
    id: "p01",
    say: "Triple twelve, triple twelve, eight",
    expect: "triple twelve triple twelve eight",
    tag: "darts",
  },
  {
    id: "p02",
    say: "Triple twenty, triple twenty, triple twenty",
    expect: "triple twenty triple twenty triple twenty",
    tag: "darts",
  },
  {
    id: "p03",
    say: "Treble twenty, twenty, one",
    expect: "treble twenty twenty one",
    tag: "darts",
  },
  {
    id: "p04",
    say: "Triple nineteen, seven, double sixteen",
    expect: "triple nineteen seven double sixteen",
    tag: "darts",
  },
  {
    id: "p05",
    say: "Single twenty, double twenty, miss",
    expect: "single twenty double twenty miss",
    tag: "darts",
  },
  {
    id: "p06",
    say: "Triple seventeen, triple eighteen, bull",
    expect: "triple seventeen triple eighteen bull",
    tag: "darts",
  },
  {
    id: "p07",
    say: "Trip twenty, dub ten",
    expect: "trip twenty dub ten",
    tag: "darts",
  },
  { id: "p08", say: "Double eight", expect: "double eight", tag: "darts" },
  {
    id: "p09",
    say: "Double eleven, double three, double one",
    expect: "double eleven double three double one",
    tag: "homophone",
  },
  {
    id: "p10",
    say: "Four, fourteen, four",
    expect: "four fourteen four",
    tag: "homophone",
  },
  {
    id: "p11",
    say: "Triple two, two, double two",
    expect: "triple two two double two",
    tag: "homophone",
  },
  {
    id: "p12",
    say: "Eight, eight, eight",
    expect: "eight eight eight",
    tag: "homophone",
  },
  {
    id: "p13",
    say: "Triple six, six",
    expect: "triple six six",
    tag: "homophone",
  },
  {
    id: "p14",
    say: "Triple ten, ten",
    expect: "triple ten ten",
    tag: "homophone",
  },
  {
    id: "p15",
    say: "Triple three, three",
    expect: "triple three three",
    tag: "homophone",
  },
  { id: "p16", say: "Tops", expect: "tops", tag: "special" },
  { id: "p17", say: "Bullseye", expect: "bullseye", tag: "special" },
  { id: "p18", say: "Outer bull", expect: "outer bull", tag: "special" },
  { id: "p19", say: "Twenty five", expect: "twenty five", tag: "special" },
  {
    id: "p20",
    say: "Miss, miss, miss",
    expect: "miss miss miss",
    tag: "special",
  },
  { id: "p21", say: "No score", expect: "no score", tag: "special" },
  { id: "p22", say: "Bounce out", expect: "bounce out", tag: "special" },
  { id: "p23", say: "One hundred", expect: "one hundred", tag: "total" },
  {
    id: "p24",
    say: "One hundred and forty",
    expect: "one hundred and forty",
    tag: "total",
  },
  { id: "p25", say: "One eighty", expect: "one eighty", tag: "total" },
  { id: "p26", say: "Ton forty", expect: "ton forty", tag: "total" },
  { id: "p27", say: "Sixty", expect: "sixty", tag: "total" },
  { id: "p28", say: "Eighty five", expect: "eighty five", tag: "total" },
  { id: "p29", say: "Undo", expect: "undo", tag: "command" },
  { id: "p30", say: "Next", expect: "next", tag: "command" },
  { id: "p31", say: "Bust", expect: "bust", tag: "command" },
  { id: "p32", say: "What's left", expect: "what's left", tag: "command" },
  { id: "p33", say: "Yes", expect: "yes", tag: "command" },
  { id: "p34", say: "Scratch that", expect: "scratch that", tag: "command" },
  { id: "p35", say: "Two hits", expect: "two hits", tag: "command" },
  {
    id: "p36",
    say: "Stop listening",
    expect: "stop listening",
    tag: "command",
  },
];

/** Hands-free run: three-dart calls, said the way you would in a game (pauses between darts are fine). */
export const HANDSFREE_PHRASES: readonly Phrase[] = PHRASES.filter(
  (p) => p.tag === "darts" || p.tag === "homophone",
).slice(0, 12);
