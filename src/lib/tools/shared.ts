import { z } from "zod";
import type { EntityKind, TagKind } from "../qloo";
import type { MiseTool } from "./types";

export function defineTool<S extends z.ZodType, T>(tool: MiseTool<S, T>): MiseTool<S, T> {
  return tool;
}

/** Entity kinds the agent can search for by name. */
export const SEARCHABLE_KINDS = [
  "artist",
  "movie",
  "tv_show",
  "brand",
  "place",
  "person",
  "book",
  "podcast",
  "videogame",
  "locality",
] as const satisfies readonly EntityKind[];

export const TAG_KIND_VALUES = [
  "keyword_media",
  "genre_media",
  "genre_music",
  "genre_brand",
  "genre_place",
  "style",
  "ambience",
  "decor",
  "setting",
  "amenity_place",
] as const satisfies readonly TagKind[];

/**
 * Filmable kinds of venue -> Qloo place genre tags (under urn:tag:genre:place:),
 * every ID seen on live hackathon responses on 2026-10-25. tourist_attraction
 * is left out on purpose: Qloo puts it on hotels, golf clubs and schools.
 */
export const VENUE_KINDS = {
  cafe: ["restaurant:cafe", "restaurant:coffee_shop", "coffee_store", "restaurant:tea_house"],
  bar: ["restaurant:bar", "restaurant:lounge_bar", "restaurant:cocktail_bar", "pub", "restaurant:brewpub"],
  restaurant: ["restaurant"],
  music_venue: ["live_music_venue", "jazz_club"],
  night_club: ["night_club"],
  gallery: ["art_gallery", "museum"],
  bookstore: ["book_store"],
  park: ["park"],
  market: ["market"],
  beach: ["beach"],
} as const;
export type VenueKind = keyof typeof VENUE_KINDS;
export const VENUE_KIND_VALUES = Object.keys(VENUE_KINDS) as [VenueKind, ...VenueKind[]];

export function venueTagIds(kinds: readonly VenueKind[]): string[] {
  return [...new Set(kinds.flatMap((kind) => VENUE_KINDS[kind].map((genre) => `urn:tag:genre:place:${genre}`)))];
}

export const entityIds = (max: number) =>
  z.array(z.string().min(1)).min(1).max(max).describe("Qloo entity IDs exactly as returned by resolve_entities or import_external_ids.");

export const tagIds = (max: number) =>
  z
    .array(z.string().startsWith("urn:tag:"))
    .max(max)
    .describe("Qloo tag IDs (urn:tag:...) exactly as returned by find_tags or read_audience. Never invent tag IDs.");

export const take = (fallback: number, max: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`How many results to return (1-${max}).`);

/**
 * Lowercase, strip Latin accents, punctuation and a leading "the" for name
 * matching and cache keys. Letters and marks of every script survive, so
 * "東京" and "서울" (or two Hindi titles) never collapse into the same key.
 */
export function normalizeName(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
  // A name made only of symbols or emoji still needs a key of its own.
  return words || name.trim().toLowerCase();
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
