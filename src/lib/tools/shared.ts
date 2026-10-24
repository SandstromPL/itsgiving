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

export const entityIds = (max: number) =>
  z
    .array(z.string().min(1))
    .min(1)
    .max(max)
    .describe("Qloo entity IDs exactly as returned by resolve_entities or import_external_ids.");

export const tagIds = (max: number) =>
  z
    .array(z.string().startsWith("urn:tag:"))
    .max(max)
    .describe("Qloo tag IDs (urn:tag:...) exactly as returned by find_tags or read_audience. Never invent tag IDs.");

export const take = (fallback: number, max: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`How many results to return (1-${max}).`);

/** Lowercase, strip accents/punctuation and a leading "the" for name matching. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
