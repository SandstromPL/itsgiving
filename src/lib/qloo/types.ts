// Response shapes as documented on docs.qloo.com. Several endpoints have
// conflicting docs (see research/qloo-api-reference.md §17), so most fields
// are optional and readers should go through ./normalize.ts.

export type ParamScalar = string | number | boolean;
export type ParamValue = ParamScalar | readonly ParamScalar[] | null | undefined;
export type QlooParams = Record<string, ParamValue>;

export interface QlooTag {
  id?: string;
  tag_id?: string;
  name: string;
  type?: string;
  types?: string[];
  subtype?: string;
  value?: string;
  tag_value?: string;
  parents?: { type: string }[];
  popularity?: number;
  query?: { affinity?: number; score?: number };
}

export interface QlooEntityQuery {
  affinity?: number | null;
  distance?: number;
  measurements?: Record<string, number>;
  explainability?: unknown;
}

export interface QlooEntity {
  name: string;
  entity_id: string;
  type?: string;
  subtype?: string;
  types?: string[];
  properties?: Record<string, unknown>;
  popularity?: number;
  tags?: QlooTag[];
  query?: QlooEntityQuery;
  disambiguation?: string;
  external?: Record<string, unknown>;
}

export interface QlooAudience {
  id: string;
  entity_id?: string;
  name: string;
  type?: string;
  parents?: { type: string }[];
}

export interface DemographicsBlock {
  entity_id: string;
  query: {
    age?: Record<string, number>;
    gender?: Record<string, number>;
  };
}

export interface HeatmapCell {
  location: { latitude: number; longitude: number; geohash: string };
  query: { affinity?: number; affinity_rank?: number; popularity?: number };
}

export interface TrendingPoint {
  date: string;
  population_percentile?: number;
  population_rank?: number;
  population_rank_velocity?: number;
  velocity_fold_change?: number;
  population_percent_delta?: number;
}

export interface InsightsResponse {
  success?: boolean;
  duration?: number;
  results?: {
    entities?: QlooEntity[];
    tags?: QlooTag[];
    demographics?: DemographicsBlock[];
    heatmap?: HeatmapCell[];
    duration?: number;
  };
  query?: Record<string, unknown>;
}

/** /search and /entities return a flat `results` array; some docs wrap it. */
export interface EntityListResponse {
  success?: boolean;
  duration?: number;
  results?: QlooEntity[] | { entities?: QlooEntity[] };
}

export interface TagsResponse {
  success?: boolean;
  results?: { tags?: QlooTag[] } | QlooTag[];
}

export interface AudiencesResponse {
  success?: boolean;
  results?: { audiences?: QlooAudience[]; entities?: QlooAudience[] } | QlooAudience[];
}

/** /v2/analysis/compare: the recipe shows tags only and no `success` field. */
export interface CompareResponse {
  duration?: number;
  results?: { tags?: QlooTag[]; entities?: QlooEntity[] };
}

export interface TrendingResponse {
  success?: boolean;
  results?: { trending?: TrendingPoint[]; entities?: QlooEntity[] };
}

export interface ApiInfoResponse {
  version?: string;
  title?: string;
  description?: string;
}
