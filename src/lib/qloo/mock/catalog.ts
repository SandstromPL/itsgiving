// SYNTHETIC development fixtures for the mock Qloo server.
// Names are real so the UI and agent can be exercised realistically, but every
// ID, tag assignment, popularity value and affinity derived from these is
// invented. Never present mock output as Qloo data. Only the four IMDb IDs
// below were verified (against Wikidata); everything else is made up.

export interface MockTag {
  id: string;
  name: string;
  type: string;
  parents: string[];
  vibes: string[];
  popularity: number;
}

export interface MockEntity {
  id: string;
  name: string;
  subtype: string;
  popularity: number;
  vibes: string[];
  tags: string[];
  properties: Record<string, unknown>;
  disambiguation?: string;
  external?: { imdb?: string; spotify?: string };
}

export interface MockAudience {
  id: string;
  name: string;
  type: string;
  vibes: string[];
}

export interface MockCity {
  name: string;
  countryCode: string;
  aliases: string[];
  center: { lat: number; lon: number };
}

export interface MockLocality {
  id: string;
  name: string;
  /** Qloo's locality genre (urn:tag:genre:locality:<kind>): city, state, suburb, neighbourhood... */
  kind: string;
  /** The mock city whose places it covers; the state covers its main city, as it does on live Qloo. */
  city: string;
  lat: number;
  lon: number;
  popularity: number;
  disambiguation: string;
}

/** Stable fake UUIDs: an all-zero prefix makes them easy to spot as mock IDs. */
export function mockId(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `00000000-0000-4000-8000-0000${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

const MOVIE = "urn:entity:movie";
const TV = "urn:entity:tv_show";
const ARTIST = "urn:entity:artist";
const PERSON = "urn:entity:person";
const BRAND = "urn:entity:brand";
const PLACE = "urn:entity:place";

const STILL = "/mock/still.svg";
const PLACE_PHOTO = "/mock/place.svg";

function tag(type: string, value: string, name: string, parents: string[], vibes: string[], popularity = 0.7): MockTag {
  return { id: `${type}:${value}`, name, type, parents, vibes, popularity };
}

const MEDIA = [MOVIE, TV];
const G_MEDIA = "urn:tag:genre:media";
const K_MEDIA = "urn:tag:keyword:media";
const G_MUSIC = "urn:tag:genre:music";
const G_FASHION = "urn:tag:genre:brand:fashion";
const STYLE = "urn:tag:style:qloo";
const AMBIENCE = "urn:tag:ambience:qloo";
const DECOR = "urn:tag:decor:qloo";
const SETTING = "urn:tag:setting:qloo";
const G_PLACE = "urn:tag:genre:place";

export const TAGS: MockTag[] = [
  tag(G_MEDIA, "thriller", "Thriller", MEDIA, ["dark", "gritty"], 0.9),
  tag(G_MEDIA, "crime", "Crime", MEDIA, ["gritty", "urban", "dark"], 0.88),
  tag(G_MEDIA, "drama", "Drama", MEDIA, ["tender", "melancholic"], 0.95),
  tag(G_MEDIA, "romance", "Romance", MEDIA, ["romantic", "tender"], 0.9),
  tag(G_MEDIA, "science_fiction", "Science Fiction", MEDIA, ["surreal", "epic"], 0.88),
  tag(G_MEDIA, "horror", "Horror", MEDIA, ["dark", "surreal"], 0.85),
  tag(G_MEDIA, "animation", "Animation", MEDIA, ["dreamy", "playful"], 0.84),
  tag(G_MEDIA, "comedy", "Comedy", MEDIA, ["playful", "warm"], 0.9),
  tag(G_MEDIA, "war", "War", MEDIA, ["epic", "dark"], 0.7),
  tag(G_MEDIA, "action", "Action", MEDIA, ["epic", "maximalist"], 0.92),
  tag(G_MEDIA, "music", "Music", MEDIA, ["rebellious", "romantic"], 0.72),
  tag(K_MEDIA, "neon_lit", "Neon-Lit", MEDIA, ["neon", "nocturnal", "urban"], 0.55),
  tag(K_MEDIA, "time_travel", "Time Travel", MEDIA, ["surreal", "retro"], 0.6),
  tag(K_MEDIA, "coming_of_age", "Coming of Age", MEDIA, ["tender", "nostalgic"], 0.75),
  tag(K_MEDIA, "unrequited_love", "Unrequited Love", MEDIA, ["romantic", "melancholic"], 0.5),
  tag(K_MEDIA, "loneliness", "Loneliness", MEDIA, ["melancholic", "intimate"], 0.55),
  tag(K_MEDIA, "folk_horror", "Folk Horror", MEDIA, ["folk", "dark", "surreal"], 0.4),
  tag(K_MEDIA, "multiverse", "Multiverse", MEDIA, ["maximalist", "epic", "playful"], 0.65),
  tag(K_MEDIA, "road_trip", "Road Trip", MEDIA, ["nostalgic", "folk", "warm"], 0.6),
  tag(K_MEDIA, "city_life", "City Life", MEDIA, ["urban", "playful"], 0.6),
  tag(K_MEDIA, "memory", "Memory", MEDIA, ["nostalgic", "melancholic", "surreal"], 0.5),
  tag(K_MEDIA, "dystopia", "Dystopia", MEDIA, ["dark", "epic", "neon"], 0.65),
  tag(K_MEDIA, "heartbreak", "Heartbreak", MEDIA, ["melancholic", "romantic"], 0.6),
  tag(K_MEDIA, "hip_hop", "Hip Hop", MEDIA, ["urban", "rebellious"], 0.55),
  tag(K_MEDIA, "small_town", "Small Town", MEDIA, ["folk", "tender"], 0.5),
  tag(K_MEDIA, "serial_killer", "Serial Killer", MEDIA, ["dark", "gritty"], 0.6),
  tag(K_MEDIA, "isolation", "Isolation", MEDIA, ["dark", "minimalist", "melancholic"], 0.45),
  tag(K_MEDIA, "skateboarding", "Skateboarding", MEDIA, ["rebellious", "urban", "playful"], 0.35),
  tag(K_MEDIA, "longing", "Longing", MEDIA, ["romantic", "melancholic", "tender"], 0.5),
  tag(K_MEDIA, "unreliable_narrator", "Unreliable Narrator", MEDIA, ["surreal", "dark"], 0.45),
  tag(G_MUSIC, "indie_folk", "Indie Folk", [ARTIST], ["folk", "tender", "intimate"], 0.6),
  tag(G_MUSIC, "rnb", "R&B", [ARTIST], ["nocturnal", "intimate", "romantic"], 0.85),
  tag(G_MUSIC, "hyperpop", "Hyperpop", [ARTIST], ["neon", "maximalist", "playful"], 0.45),
  tag(G_MUSIC, "synthpop", "Synthpop", [ARTIST], ["neon", "retro", "nocturnal"], 0.7),
  tag(G_MUSIC, "dream_pop", "Dream Pop", [ARTIST], ["dreamy", "nostalgic"], 0.55),
  tag(G_MUSIC, "psychedelic_rock", "Psychedelic Rock", [ARTIST], ["surreal", "dreamy", "retro"], 0.6),
  tag(G_MUSIC, "soundtrack", "Soundtrack", [ARTIST], ["epic", "romantic"], 0.7),
  tag(G_MUSIC, "bollywood", "Bollywood", [ARTIST], ["romantic", "warm", "epic"], 0.8),
  tag(G_MUSIC, "pop", "Pop", [ARTIST], ["playful", "romantic"], 0.95),
  tag(G_MUSIC, "hip_hop", "Hip Hop", [ARTIST], ["urban", "rebellious", "gritty"], 0.9),
  { id: G_FASHION, name: "Fashion", type: "urn:tag:genre:brand", parents: [BRAND], vibes: [], popularity: 0.95 },
  tag(G_FASHION, "streetwear", "Streetwear", [BRAND], ["urban", "rebellious", "playful"], 0.8),
  tag(G_FASHION, "luxury", "Luxury Fashion", [BRAND], ["maximalist", "romantic"], 0.85),
  tag(G_FASHION, "denim", "Denim", [BRAND], ["retro", "nostalgic"], 0.75),
  tag(G_FASHION, "basics", "Basics", [BRAND], ["minimalist"], 0.8),
  tag(G_FASHION, "footwear", "Footwear", [BRAND], ["rebellious", "urban"], 0.8),
  tag(G_FASHION, "ethnic_wear", "Ethnic Wear", [BRAND], ["folk", "warm"], 0.6),
  tag(G_FASHION, "contemporary", "Contemporary Fashion", [BRAND], ["minimalist", "tender"], 0.7),
  tag(STYLE, "minimalist", "Minimalist", [BRAND, PLACE], ["minimalist"], 0.7),
  tag(STYLE, "vintage", "Vintage", [BRAND, PLACE], ["retro", "nostalgic"], 0.7),
  tag(STYLE, "bohemian", "Bohemian", [BRAND, PLACE], ["folk", "warm", "dreamy"], 0.6),
  tag(STYLE, "edgy", "Edgy", [BRAND, PLACE], ["rebellious", "dark", "gritty"], 0.6),
  tag(AMBIENCE, "intimate", "Intimate", [PLACE], ["intimate", "romantic", "tender"], 0.7),
  tag(AMBIENCE, "romantic", "Romantic", [PLACE], ["romantic", "intimate", "nocturnal"], 0.7),
  tag(AMBIENCE, "cozy", "Cozy", [PLACE], ["warm", "tender", "nostalgic"], 0.75),
  tag(AMBIENCE, "lively", "Lively", [PLACE], ["playful", "urban", "maximalist"], 0.8),
  tag(AMBIENCE, "trendy", "Trendy", [PLACE], ["neon", "urban", "maximalist"], 0.75),
  tag(AMBIENCE, "upscale", "Upscale", [PLACE], ["romantic", "maximalist"], 0.65),
  tag(AMBIENCE, "moody", "Moody", [PLACE], ["nocturnal", "dark", "melancholic"], 0.5),
  tag(DECOR, "vintage", "Vintage Decor", [PLACE], ["retro", "nostalgic"], 0.6),
  tag(DECOR, "art_deco", "Art Deco", [PLACE], ["retro", "romantic", "maximalist"], 0.45),
  tag(DECOR, "industrial", "Industrial", [PLACE], ["gritty", "urban", "minimalist"], 0.5),
  tag(DECOR, "neon_signage", "Neon Signage", [PLACE], ["neon", "nocturnal", "retro"], 0.4),
  tag(SETTING, "rooftop", "Rooftop", [PLACE], ["urban", "nocturnal", "epic"], 0.55),
  tag(SETTING, "waterfront", "Waterfront", [PLACE], ["dreamy", "romantic", "melancholic"], 0.5),
  // Same genre IDs as live Qloo, so venue kinds map identically in mock mode.
  tag(G_PLACE, "restaurant:cafe", "Cafe", [PLACE], ["warm", "tender"], 0.85),
  tag(G_PLACE, "restaurant", "Restaurant", [PLACE], ["warm"], 0.95),
  tag(G_PLACE, "restaurant:bar", "Bar", [PLACE], ["nocturnal", "urban"], 0.85),
  tag(G_PLACE, "live_music_venue", "Live Music Venue", [PLACE], ["rebellious", "nocturnal"], 0.6),
  tag(G_PLACE, "book_store", "Book Store", [PLACE], ["intimate", "nostalgic", "tender"], 0.5),
  tag(G_PLACE, "park", "Park", [PLACE], ["warm", "dreamy", "tender"], 0.7),
];

const SUBGENRE = "urn:tag:subgenre:qloo";

/**
 * Film subgenres, under live Qloo's IDs for the film traditions the cover's eras borrow from (studio/eras.ts), with a
 * few others and one that names who people are, which the pipeline must drop. The mock serves them only to a call that
 * asks for subgenres, so the tag search and comparisons above never see them.
 */
export const SUBGENRES: MockTag[] = [
  tag(SUBGENRE, "observational", "Observational", [MOVIE], ["intimate", "minimalist", "tender"], 0.6),
  tag(SUBGENRE, "character_driven", "Character-Driven", [MOVIE], ["intimate", "melancholic", "tender"], 0.7),
  tag(SUBGENRE, "lgbtq_cinema", "LGBTQ Cinema", [MOVIE], ["tender", "intimate", "rebellious"], 0.6),
  tag(SUBGENRE, "bollywood", "Bollywood", [MOVIE], ["romantic", "warm", "epic", "maximalist"], 0.8),
  tag(SUBGENRE, "french_new_wave", "French New Wave", [MOVIE], ["rebellious", "minimalist", "playful", "urban"], 0.55),
  tag(SUBGENRE, "hong_kong_new_wave", "Hong Kong New Wave", [MOVIE], ["neon", "nocturnal", "melancholic", "romantic"], 0.5),
  tag(SUBGENRE, "hollywood_musical", "Hollywood Musical", [MOVIE], ["epic", "romantic", "retro", "playful"], 0.6),
  tag(SUBGENRE, "noir", "Noir", [MOVIE], ["dark", "gritty", "nocturnal"], 0.6),
  tag(SUBGENRE, "romantic_tragedy", "Romantic Tragedy", [MOVIE], ["romantic", "melancholic"], 0.6),
];

export const CITIES: MockCity[] = [
  { name: "Mumbai", countryCode: "IN", aliases: ["mumbai", "bombay", "mumbai, india"], center: { lat: 19.076, lon: 72.8777 } },
  {
    name: "New York",
    countryCode: "US",
    aliases: ["new york", "new york city", "nyc", "new york, ny", "the big apple", "manhattan", "brooklyn"],
    center: { lat: 40.7128, lon: -74.006 },
  },
];

function locality(name: string, kind: string, city: string, coords: [number, number], disambiguation: string, popularity = 0.95): MockLocality {
  return { id: mockId(`urn:entity:locality:${disambiguation}`), name, kind, city, lat: coords[0], lon: coords[1], popularity, disambiguation };
}

const NYC = "New York, New York, United States of America";

/**
 * The two cities and the neighbourhoods around the mock places. Like live Qloo, a search for "New York"
 * lists the state (centred upstate, far from every mock place) before the city.
 */
export const LOCALITIES: MockLocality[] = [
  locality("Mumbai", "city", "Mumbai", [19.076, 72.8777], "Mumbai, Maharashtra, India", 1),
  locality("New York", "state", "New York", [42.9226, -75.5978], "New York, United States of America", 1),
  locality("New York", "city", "New York", [40.7128, -74.006], NYC, 1),
  locality("Juhu", "suburb", "Mumbai", [19.1075, 72.8263], "Juhu, K/W Ward, Mumbai, Maharashtra, India"),
  locality("Bandra West", "suburb", "Mumbai", [19.0596, 72.8295], "Bandra West, H/W Ward, Mumbai, Maharashtra, India"),
  locality("Worli", "suburb", "Mumbai", [19.0166, 72.8172], "Worli, G/S Ward, Mumbai, Maharashtra, India"),
  locality("Lower Parel", "suburb", "Mumbai", [18.9953, 72.8302], "Lower Parel, G/S Ward, Mumbai, Maharashtra, India"),
  locality("Colaba", "suburb", "Mumbai", [18.9067, 72.8147], "Colaba, A Ward, Mumbai, Maharashtra, India"),
  locality("Fort", "neighbourhood", "Mumbai", [18.9322, 72.8351], "Fort, A Ward, Mumbai, Maharashtra, India"),
  locality("Ballard Estate", "neighbourhood", "Mumbai", [18.9396, 72.8406], "Ballard Estate, A Ward, Mumbai, Maharashtra, India"),
  locality("Dhobi Talao", "neighbourhood", "Mumbai", [18.9446, 72.8298], "Dhobi Talao, C Ward, Mumbai, Maharashtra, India"),
  locality("SoHo", "neighbourhood", "New York", [40.7233, -74.003], `SoHo, Manhattan, ${NYC}`),
  locality("East Village", "neighbourhood", "New York", [40.7265, -73.9815], `East Village, Manhattan, ${NYC}`),
  locality("West Village", "neighbourhood", "New York", [40.7358, -74.0036], `West Village, Manhattan, ${NYC}`),
  locality("Greenwich Village", "neighbourhood", "New York", [40.7336, -74.0027], `Greenwich Village, Manhattan, ${NYC}`),
  locality("Tribeca", "neighbourhood", "New York", [40.7163, -74.0086], `Tribeca, Manhattan, ${NYC}`),
  locality("Lower East Side", "neighbourhood", "New York", [40.715, -73.9843], `Lower East Side, Manhattan, ${NYC}`),
  locality("Upper East Side", "neighbourhood", "New York", [40.7736, -73.9566], `Upper East Side, Manhattan, ${NYC}`),
  locality("Bushwick", "neighbourhood", "New York", [40.6944, -73.9213], `Bushwick, Brooklyn, ${NYC}`),
];

function film(
  name: string,
  year: number,
  popularity: number,
  vibes: string[],
  tags: string[],
  extra: { imdb?: string; subtype?: string; disambiguation?: string; description?: string } = {},
): MockEntity {
  const subtype = extra.subtype ?? MOVIE;
  return {
    id: mockId(`${subtype}:${name}:${year}`),
    name,
    subtype,
    popularity,
    vibes,
    tags,
    disambiguation: extra.disambiguation ?? String(year),
    properties: { release_year: year, image: { url: STILL }, description: extra.description },
    external: extra.imdb ? { imdb: extra.imdb } : undefined,
  };
}

function artist(name: string, popularity: number, vibes: string[], tags: string[], spotify?: string): MockEntity {
  return {
    id: mockId(`${ARTIST}:${name}`),
    name,
    subtype: ARTIST,
    popularity,
    vibes,
    tags,
    properties: { image: { url: STILL } },
    external: spotify ? { spotify } : undefined,
  };
}

/** Live Qloo files some musicians only as people (Raftaar, 2026-10-26). */
function person(name: string, popularity: number, vibes: string[]): MockEntity {
  return { id: mockId(`${PERSON}:${name}`), name, subtype: PERSON, popularity, vibes, tags: [], properties: { image: { url: STILL } } };
}

function brand(name: string, popularity: number, vibes: string[], tags: string[]): MockEntity {
  // Live clothing brands carry the parent genre (urn:tag:genre:brand:fashion) as well as the specific ones.
  return { id: mockId(`${BRAND}:${name}`), name, subtype: BRAND, popularity, vibes, tags: [G_FASHION, ...tags], properties: {} };
}

function place(
  name: string,
  city: string,
  neighborhood: string,
  priceLevel: number,
  coords: [number, number],
  popularity: number,
  vibes: string[],
  tags: string[],
  hasPhoto = true,
): MockEntity {
  const cityInfo = CITIES.find((c) => c.name === city);
  return {
    id: mockId(`${PLACE}:${name}:${city}`),
    name,
    subtype: PLACE,
    popularity,
    vibes,
    tags,
    disambiguation: `${neighborhood}, ${city}`,
    properties: {
      address: `${neighborhood}, ${city}`,
      neighborhood,
      geocode: { city, country_code: cityInfo?.countryCode },
      price_level: priceLevel,
      lat: coords[0],
      lon: coords[1],
      ...(hasPhoto ? { image: { url: PLACE_PHOTO } } : {}),
    },
  };
}

const g = (value: string) => `${G_MEDIA}:${value}`;
const k = (value: string) => `${K_MEDIA}:${value}`;
const m = (value: string) => `${G_MUSIC}:${value}`;
const f = (value: string) => `${G_FASHION}:${value}`;
const s = (value: string) => `${STYLE}:${value}`;
const a = (value: string) => `${AMBIENCE}:${value}`;
const d = (value: string) => `${DECOR}:${value}`;
const st = (value: string) => `${SETTING}:${value}`;
const p = (value: string) => `${G_PLACE}:${value}`;

export const ENTITIES: MockEntity[] = [
  film("Se7en", 1995, 0.97, ["dark", "gritty", "urban", "nocturnal"], [g("thriller"), g("crime"), k("serial_killer")], { imdb: "tt0114369" }),
  film("Donnie Darko", 2001, 0.93, ["surreal", "melancholic", "nostalgic", "dark"], [g("science_fiction"), g("drama"), k("time_travel")], { imdb: "tt0246578" }),
  film("Incendies", 2010, 0.86, ["epic", "dark", "tender"], [g("drama"), g("war"), k("memory")], { imdb: "tt1255953" }),
  film("A Silent Voice", 2016, 0.88, ["tender", "melancholic", "dreamy"], [g("animation"), g("drama"), k("coming_of_age")], { imdb: "tt5323662" }),
  film("In the Mood for Love", 2000, 0.9, ["romantic", "melancholic", "retro", "intimate", "nocturnal"], [g("romance"), g("drama"), k("longing"), k("unrequited_love")]),
  film("Chungking Express", 1994, 0.87, ["neon", "playful", "nocturnal", "romantic", "urban"], [g("romance"), g("comedy"), k("neon_lit"), k("city_life")]),
  film("Fallen Angels", 1995, 0.78, ["neon", "nocturnal", "gritty", "urban", "melancholic"], [g("crime"), g("romance"), k("neon_lit")], { disambiguation: "1995, Wong Kar-wai" }),
  film("Fallen Angels", 1993, 0.4, ["dark", "retro", "gritty"], [g("crime")], { subtype: TV, disambiguation: "1993, TV series" }),
  film("Drive", 2011, 0.93, ["neon", "nocturnal", "retro", "dark"], [g("crime"), g("thriller"), k("neon_lit")]),
  film("Blade Runner 2049", 2017, 0.95, ["neon", "epic", "surreal", "melancholic"], [g("science_fiction"), k("dystopia")]),
  film("Lost in Translation", 2003, 0.91, ["melancholic", "dreamy", "intimate", "urban", "nocturnal"], [g("drama"), g("romance"), k("loneliness"), k("city_life")]),
  film("Her", 2013, 0.92, ["tender", "dreamy", "melancholic", "warm"], [g("romance"), g("science_fiction"), k("loneliness")]),
  film("Moonlight", 2016, 0.9, ["tender", "intimate", "melancholic", "warm"], [g("drama"), k("coming_of_age")]),
  film("Aftersun", 2022, 0.82, ["nostalgic", "tender", "melancholic", "warm"], [g("drama"), k("memory"), k("coming_of_age")]),
  film("Past Lives", 2023, 0.86, ["tender", "romantic", "melancholic", "minimalist"], [g("romance"), g("drama"), k("longing")]),
  film("Midsommar", 2019, 0.9, ["surreal", "dark", "folk", "epic"], [g("horror"), k("folk_horror")]),
  film("The Lighthouse", 2019, 0.8, ["dark", "surreal", "gritty"], [g("horror"), g("drama"), k("isolation")]),
  film("I'm Thinking of Ending Things", 2020, 0.74, ["surreal", "melancholic", "dark", "minimalist"], [g("drama"), k("memory"), k("unreliable_narrator")]),
  film("Predestination", 2014, 0.8, ["surreal", "dark", "retro"], [g("science_fiction"), g("thriller"), k("time_travel")]),
  film("Spider-Man: Across the Spider-Verse", 2023, 0.97, ["maximalist", "playful", "epic", "neon", "rebellious"], [g("animation"), g("action"), k("multiverse")]),
  film("Paris, Texas", 1984, 0.79, ["melancholic", "nostalgic", "warm", "folk"], [g("drama"), k("road_trip")]),
  film("Rockstar", 2011, 0.8, ["rebellious", "romantic", "epic", "melancholic"], [g("drama"), g("music"), k("heartbreak")], { disambiguation: "2011, Imtiaz Ali" }),
  film("Dev.D", 2009, 0.72, ["neon", "gritty", "rebellious", "dark", "playful"], [g("drama"), k("neon_lit"), k("heartbreak")]),
  film("Gully Boy", 2019, 0.82, ["urban", "rebellious", "gritty", "warm"], [g("drama"), g("music"), k("hip_hop")]),
  film("Masaan", 2015, 0.7, ["tender", "melancholic", "folk", "intimate"], [g("drama"), k("small_town")]),
  film("Your Name", 2016, 0.92, ["dreamy", "romantic", "epic", "tender"], [g("animation"), g("romance"), k("time_travel")], { disambiguation: "2016, Makoto Shinkai" }),
  // Same normalized name ("forgotten"): exercises the ambiguous-resolution path.
  film("Forgotten", 2017, 0.62, ["dark", "surreal", "melancholic"], [g("thriller"), k("memory"), k("unreliable_narrator")], { disambiguation: "2017, Jang Hang-jun" }),
  film("The Forgotten", 2004, 0.58, ["dark", "surreal"], [g("thriller"), g("science_fiction"), k("memory")], { disambiguation: "2004, Joseph Ruben" }),
  film("Mid90s", 2018, 0.75, ["nostalgic", "gritty", "rebellious", "urban"], [g("drama"), k("skateboarding"), k("coming_of_age")]),
  film("Euphoria", 2019, 0.93, ["neon", "dark", "rebellious", "maximalist"], [g("drama"), k("coming_of_age")], { subtype: TV }),

  artist("Prateek Kuhad", 0.7, ["folk", "tender", "melancholic", "intimate", "warm"], [m("indie_folk")]),
  artist("When Chai Met Toast", 0.55, ["folk", "playful", "warm", "tender"], [m("indie_folk")]),
  artist("Phoebe Bridgers", 0.82, ["melancholic", "tender", "dark", "intimate"], [m("indie_folk")]),
  artist("Frank Ocean", 0.9, ["nocturnal", "dreamy", "melancholic", "intimate", "tender"], [m("rnb")]),
  artist("Charli xcx", 0.88, ["neon", "maximalist", "playful", "rebellious", "urban"], [m("hyperpop"), m("pop")]),
  artist("The Weeknd", 0.97, ["nocturnal", "neon", "dark", "retro", "epic"], [m("rnb"), m("synthpop")]),
  artist("Lana Del Rey", 0.93, ["nostalgic", "romantic", "melancholic", "retro", "dreamy"], [m("dream_pop")]),
  artist("Tame Impala", 0.86, ["dreamy", "surreal", "retro"], [m("psychedelic_rock")]),
  artist("A. R. Rahman", 0.9, ["epic", "romantic", "warm", "folk"], [m("soundtrack"), m("bollywood")]),
  artist("Arijit Singh", 0.92, ["romantic", "tender", "melancholic", "warm"], [m("bollywood")]),
  artist("Bon Iver", 0.8, ["folk", "intimate", "melancholic", "minimalist"], [m("indie_folk")]),
  // Spotify ID taken from Qloo's own recipe "resolve-a-spotify-id-to-a-qloo-entity".
  artist("Sabrina Carpenter", 0.9, ["playful", "romantic", "retro", "maximalist"], [m("pop")], "74KM79TiuVKeVCqs8QtB0B"),
  artist("Divine", 0.7, ["urban", "gritty", "rebellious"], [m("hip_hop")]),
  person("Raftaar", 0.9, ["urban", "rebellious", "epic", "playful"]),

  brand("Nicobar", 0.45, ["warm", "minimalist", "folk", "tender"], [f("contemporary"), s("bohemian")]),
  brand("Fabindia", 0.7, ["warm", "folk", "nostalgic"], [f("ethnic_wear"), s("bohemian")]),
  brand("Carhartt WIP", 0.8, ["urban", "gritty", "rebellious"], [f("streetwear"), s("edgy")]),
  brand("Stüssy", 0.78, ["urban", "playful", "retro", "rebellious"], [f("streetwear")]),
  brand("Acne Studios", 0.74, ["minimalist", "surreal", "melancholic"], [f("luxury"), s("minimalist")]),
  brand("A.P.C.", 0.68, ["minimalist", "retro", "tender"], [f("contemporary"), s("minimalist")]),
  brand("Gucci", 0.96, ["maximalist", "romantic", "retro", "epic"], [f("luxury")]),
  brand("Levi's", 0.95, ["retro", "nostalgic", "urban"], [f("denim"), s("vintage")]),
  brand("Bode", 0.5, ["nostalgic", "tender", "folk", "retro"], [f("luxury"), s("vintage")]),
  brand("Uniqlo", 0.93, ["minimalist", "warm"], [f("basics"), s("minimalist")]),
  brand("Dr. Martens", 0.85, ["rebellious", "gritty", "retro", "dark"], [f("footwear"), s("edgy")]),
  brand("Jacquemus", 0.8, ["playful", "romantic", "dreamy", "warm"], [f("luxury")]),

  place("Prithvi Cafe", "Mumbai", "Juhu", 1, [19.1057, 72.8264], 0.72, ["warm", "intimate", "nostalgic", "folk", "tender"], [p("restaurant:cafe"), a("cozy"), a("intimate"), s("bohemian")]),
  place("Kala Ghoda Cafe", "Mumbai", "Fort", 2, [18.9289, 72.8318], 0.66, ["minimalist", "warm", "tender"], [p("restaurant:cafe"), a("cozy"), s("minimalist")]),
  place("Kyani & Co.", "Mumbai", "Dhobi Talao", 1, [18.9445, 72.8296], 0.6, ["nostalgic", "retro", "warm"], [p("restaurant:cafe"), d("vintage"), a("cozy")]),
  place("Leopold Cafe", "Mumbai", "Colaba", 2, [18.9227, 72.8317], 0.8, ["retro", "gritty", "urban", "playful"], [p("restaurant"), p("restaurant:bar"), a("lively"), d("vintage")]),
  place("Aer", "Mumbai", "Worli", 4, [19.0176, 72.8172], 0.7, ["neon", "nocturnal", "urban", "maximalist", "epic"], [p("restaurant:bar"), st("rooftop"), a("trendy"), a("upscale")]),
  place("Bonobo", "Mumbai", "Bandra", 2, [19.0645, 72.8352], 0.62, ["nocturnal", "rebellious", "urban", "playful"], [p("restaurant:bar"), a("lively"), a("trendy")], false),
  place("The Bombay Canteen", "Mumbai", "Lower Parel", 3, [18.9965, 72.8251], 0.75, ["playful", "warm", "retro"], [p("restaurant"), a("lively")]),
  place("The Clearing House", "Mumbai", "Ballard Estate", 3, [18.9375, 72.8401], 0.55, ["romantic", "intimate", "retro", "tender"], [p("restaurant"), a("romantic"), a("intimate"), d("vintage")]),
  // A few more around the heatmap's hot spots, so a 2 km shoot base can hold in mock mode too.
  place("Kitab Khana", "Mumbai", "Fort", 2, [18.9327, 72.8335], 0.55, ["nostalgic", "intimate", "tender", "warm"], [p("book_store"), a("cozy"), d("vintage")]),
  place("Horniman Circle Garden", "Mumbai", "Fort", 1, [18.9331, 72.8347], 0.6, ["nostalgic", "tender", "dreamy", "retro"], [p("park")]),
  place("Cafe Mondegar", "Mumbai", "Colaba", 2, [18.9236, 72.8317], 0.7, ["retro", "playful", "nostalgic", "urban"], [p("restaurant:cafe"), p("restaurant:bar"), a("lively"), d("vintage")]),
  place("Balthazar", "New York", "SoHo", 3, [40.7226, -73.9981], 0.95, ["romantic", "retro", "maximalist", "urban"], [p("restaurant"), a("lively"), d("art_deco")]),
  place("Veselka", "New York", "East Village", 1, [40.729, -73.9871], 0.78, ["nostalgic", "warm", "urban"], [p("restaurant"), a("cozy")]),
  place("Bemelmans Bar", "New York", "Upper East Side", 4, [40.7744, -73.9632], 0.8, ["nocturnal", "retro", "intimate", "romantic"], [p("restaurant:bar"), a("intimate"), a("upscale"), d("art_deco")]),
  place("Dante", "New York", "West Village", 3, [40.7303, -74.0021], 0.82, ["romantic", "retro", "warm"], [p("restaurant:bar"), a("romantic"), d("vintage")]),
  place("Elsewhere", "New York", "Bushwick", 2, [40.7062, -73.9235], 0.7, ["neon", "nocturnal", "rebellious", "urban"], [p("live_music_venue"), st("rooftop"), a("lively"), s("edgy")]),
  place("The Odeon", "New York", "Tribeca", 3, [40.7169, -74.0077], 0.76, ["nocturnal", "retro", "urban", "neon"], [p("restaurant"), d("neon_signage"), d("art_deco"), a("moody")]),
  place("Russ & Daughters Cafe", "New York", "Lower East Side", 2, [40.7202, -73.9895], 0.72, ["nostalgic", "warm"], [p("restaurant:cafe"), d("vintage"), a("cozy")], false),
  place("McNally Jackson", "New York", "SoHo", 2, [40.7238, -73.9961], 0.62, ["intimate", "minimalist", "tender", "urban"], [p("book_store"), a("cozy")]),
  place("Washington Square Park", "New York", "Greenwich Village", 1, [40.7308, -73.9973], 0.9, ["dreamy", "urban", "playful", "warm"], [p("park"), a("lively")]),
  place("Caffe Reggio", "New York", "Greenwich Village", 2, [40.7302, -74.0001], 0.66, ["nostalgic", "retro", "romantic", "warm"], [p("restaurant:cafe"), d("vintage"), a("cozy")]),
  place("Mercury Lounge", "New York", "Lower East Side", 2, [40.7222, -73.9867], 0.64, ["rebellious", "nocturnal", "gritty", "urban"], [p("live_music_venue"), a("moody")]),
];

/** ID of a mock entity by name, for examples and tests. Throws if it isn't in the catalog. */
export function mockEntityId(name: string, subtype?: string): string {
  const entity = ENTITIES.find((e) => e.name === name && (!subtype || e.subtype === subtype));
  if (!entity) throw new Error(`No mock entity named ${name}`);
  return entity.id;
}

export const AUDIENCES: MockAudience[] = [
  { id: "urn:audience:hobbies_and_interests:film_buffs", name: "Film Buffs", type: "urn:audience:hobbies_and_interests", vibes: ["surreal", "melancholic", "retro"] },
  { id: "urn:audience:hobbies_and_interests:live_music", name: "Live Music", type: "urn:audience:hobbies_and_interests", vibes: ["rebellious", "urban", "playful"] },
  { id: "urn:audience:hobbies_and_interests:fashion", name: "Fashion", type: "urn:audience:hobbies_and_interests", vibes: ["maximalist", "minimalist", "urban"] },
  { id: "urn:audience:life_stage:college_students", name: "College Students", type: "urn:audience:life_stage", vibes: ["playful", "rebellious", "neon"] },
  { id: "urn:audience:leisure:nightlife", name: "Nightlife", type: "urn:audience:leisure", vibes: ["nocturnal", "neon", "urban"] },
  { id: "urn:audience:global_issues:sustainability", name: "Sustainability", type: "urn:audience:global_issues", vibes: ["folk", "minimalist", "warm"] },
];
