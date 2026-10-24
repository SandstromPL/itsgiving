import type {
  AudiencesResponse,
  QlooAudience,
  QlooEntity,
  QlooTag,
  TagsResponse,
} from "./types";
import { kindFromUrn, type EntityKind } from "./urns";

// Readers that tolerate the response-shape conflicts across Qloo's docs, and
// compact views that keep verbose fields (akas, external blobs, long tag lists)
// out of the LLM's context.

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function entityList(data: unknown): QlooEntity[] {
  const results = isRecord(data) ? data.results : undefined;
  if (Array.isArray(results)) return results as QlooEntity[];
  if (isRecord(results) && Array.isArray(results.entities)) return results.entities as QlooEntity[];
  return [];
}

export function tagList(data: TagsResponse | unknown): QlooTag[] {
  const results = isRecord(data) ? data.results : undefined;
  if (Array.isArray(results)) return results as QlooTag[];
  if (isRecord(results) && Array.isArray(results.tags)) return results.tags as QlooTag[];
  return [];
}

export function audienceList(data: AudiencesResponse | unknown): QlooAudience[] {
  const results = isRecord(data) ? data.results : undefined;
  if (Array.isArray(results)) return results as QlooAudience[];
  if (isRecord(results)) {
    if (Array.isArray(results.audiences)) return results.audiences as QlooAudience[];
    if (Array.isArray(results.entities)) return results.entities as QlooAudience[];
  }
  return [];
}

export function tagId(tag: QlooTag): string {
  return tag.tag_id ?? tag.id ?? "";
}

export interface Contribution {
  entity_id: string;
  score: number;
}

/**
 * The exact shape of `query.explainability` isn't pinned down in the docs, so
 * collect every {entity_id, score}-like pair found anywhere inside it.
 */
export function extractContributions(explainability: unknown, limit = 5): Contribution[] {
  const found = new Map<string, number>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = node as Loose;
    const id = str(record.entity_id) ?? str(record.id);
    const score = num(record.score) ?? num(record.value) ?? num(record.weight) ?? num(record.contribution);
    if (id && score !== undefined) {
      found.set(id, Math.max(score, found.get(id) ?? -Infinity));
    }
    Object.values(record).forEach((child) => visit(child, depth + 1));
  };
  visit(explainability, 0);
  return [...found.entries()]
    .map(([entity_id, score]) => ({ entity_id, score: Math.round(score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface CompactPlace {
  address?: string;
  neighborhood?: string;
  city?: string;
  country_code?: string;
  price_level?: number;
  business_rating?: number;
  lat?: number;
  lon?: number;
}

export interface CompactEntity {
  id: string;
  name: string;
  kind?: EntityKind;
  type?: string;
  year?: number;
  disambiguation?: string;
  description?: string;
  image?: string;
  popularity?: number;
  affinity?: number | null;
  tags: string[];
  because?: Contribution[];
  place?: CompactPlace;
  external?: { imdb?: string; spotify?: string; letterboxd?: string };
}

function firstExternalId(external: unknown, key: string): string | undefined {
  if (!isRecord(external)) return undefined;
  const value = external[key];
  if (Array.isArray(value)) {
    const first = value[0];
    return isRecord(first) ? str(first.id) : str(first);
  }
  return isRecord(value) ? str(value.id) : str(value);
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function round(value: number | undefined | null): number | undefined | null {
  if (value === null) return null;
  return value === undefined ? undefined : Math.round(value * 1000) / 1000;
}

export function compactEntity(
  entity: QlooEntity,
  options: { maxTags?: number; maxDescription?: number } = {},
): CompactEntity {
  const props: Loose = isRecord(entity.properties) ? entity.properties : {};
  const geocode: Loose = isRecord(props.geocode) ? props.geocode : {};
  const location: Loose = isRecord(props.location) ? props.location : {};
  const type = entity.subtype ?? entity.types?.[0] ?? entity.type;
  const kind = kindFromUrn(type);

  const compact: CompactEntity = {
    id: entity.entity_id,
    name: entity.name,
    kind,
    type,
    year: num(props.release_year) ?? num(props.publication_year),
    disambiguation: str(entity.disambiguation),
    description: truncate(str(props.description) ?? str(props.short_description), options.maxDescription ?? 240),
    image: isRecord(props.image) ? str(props.image.url) : undefined,
    popularity: round(num(entity.popularity)) ?? undefined,
    affinity: entity.query && "affinity" in entity.query ? round(entity.query.affinity ?? null) : undefined,
    tags: (entity.tags ?? []).slice(0, options.maxTags ?? 8).map((tag) => tag.name),
  };

  const because = extractContributions(entity.query?.explainability);
  if (because.length > 0) compact.because = because;

  if (kind === "place") {
    compact.place = {
      address: str(props.address),
      neighborhood: str(props.neighborhood) ?? str(geocode.neighborhood),
      city: str(geocode.city) ?? str(props.city),
      country_code: str(geocode.country_code) ?? str(props.country_code),
      price_level: num(props.price_level),
      business_rating: num(props.business_rating),
      lat: num(props.lat) ?? num(props.latitude) ?? num(location.lat) ?? num(geocode.latitude),
      lon: num(props.lon) ?? num(props.longitude) ?? num(location.lon) ?? num(geocode.longitude),
    };
  }

  const external = {
    imdb: firstExternalId(entity.external, "imdb"),
    spotify: firstExternalId(entity.external, "spotify"),
    letterboxd: firstExternalId(entity.external, "letterboxd"),
  };
  if (external.imdb || external.spotify || external.letterboxd) compact.external = external;

  return compact;
}

export interface CompactTag {
  id: string;
  name: string;
  type?: string;
  affinity?: number;
  score?: number;
}

export function compactTag(tag: QlooTag): CompactTag {
  return {
    id: tagId(tag),
    name: tag.name,
    type: tag.subtype ?? tag.type ?? tag.types?.[0],
    affinity: round(tag.query?.affinity) ?? undefined,
    score: round(tag.query?.score) ?? undefined,
  };
}
