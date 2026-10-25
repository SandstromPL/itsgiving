// Example briefs, shared by the browser and the featured script (no Node imports here). The empty
// board offers them; `npm run featured` pre-builds the ones marked featured so they open instantly.
// Every name exists in live Qloo and in the mock catalog, and titles that live Qloo knows more than
// one of carry their year, so only the last example stops to ask.

import type { BriefInput } from "./brief";

export interface Example {
  slug: string;
  title: string;
  detail: string;
  brief: BriefInput;
  featured: boolean;
}

export const EXAMPLES: Example[] = [
  {
    slug: "prateek-kuhad-mumbai",
    title: "Prateek Kuhad",
    detail: "Music video in Mumbai on an indie budget, with your taste in films.",
    brief: { artist: "Prateek Kuhad", city: "Mumbai", director_films: ["In the Mood for Love", "Donnie Darko", "Rockstar (2011)"] },
    featured: true,
  },
  {
    slug: "charli-xcx-new-york",
    title: "Charli xcx",
    detail: "Music video in New York on a premium budget.",
    brief: { artist: "Charli xcx", city: "New York", budget: "premium", director_films: ["Chungking Express", "Drive (2011)"] },
    featured: true,
  },
  {
    slug: "phoebe-bridgers-new-york",
    title: "Phoebe Bridgers",
    detail: "Music video in New York on an indie budget.",
    brief: { artist: "Phoebe Bridgers", city: "New York", director_films: ["Lost in Translation", "Paris, Texas"] },
    featured: true,
  },
  {
    slug: "after-past-lives-aftersun",
    title: "After Past Lives and Aftersun",
    detail: "A short film in Mumbai on a shoestring.",
    brief: {
      format: "short_film",
      touchstones: ["Past Lives (2023)", "Aftersun (2022)"],
      city: "Mumbai",
      budget: "shoestring",
      director_films: ["Masaan (2015)"],
    },
    featured: true,
  },
  {
    slug: "frank-ocean-forgotten",
    title: "Frank Ocean",
    detail: "Music video in New York, with a title to pick.",
    brief: { artist: "Frank Ocean", touchstones: ["Forgotten"], city: "New York" },
    featured: false,
  },
];
