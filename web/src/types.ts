export type AiProtocol = "auto" | "anthropic" | "openai";

export interface AiConfigGroup {
  keyConfigured: boolean;
  keySource: "none" | "session" | "user-db" | "station" | "writer-session" | "writer-db";
  isDedicated?: boolean;
  baseUrl: string | null;
  protocol: AiProtocol;
  model: string | null;
}

export interface AiSettings {
  writer?: AiConfigGroup;
  distill?: AiConfigGroup;
  world?: AiConfigGroup;
  agent?: AiConfigGroup;
  keyConfigured: boolean;
  keySource: "none" | "session" | "user-db" | "station";
  baseUrl: string | null;
  protocol: AiProtocol;
  model: string | null;
  stationConfigured: boolean;
}
export interface User {
  id: number;
  username: string;
  role: "admin" | "author";
  ai_api_key_enabled: boolean;
  distill_api_key_enabled?: boolean;
  world_api_key_enabled?: boolean;
  agent_api_key_enabled?: boolean;
  created_at: string;
}

export interface Novel {
  id: number;
  user_id: number;
  title: string;
  author: string;
  genre: string;
  status: string;
  intro: string;
  cover_color: string;
  word_count: number;
  is_public?: number;
  created_at: string;
  updated_at: string;
  owner?: string;
  chapters?: ChapterMeta[];
  characters?: Character[];
  mapCount?: number;
}

export interface ChapterMeta {
  id: number;
  title: string;
  status: string;
  word_count: number;
  sort_order: number;
  updated_at: string;
}

export interface Chapter extends ChapterMeta {
  novel_id: number;
  content: string;
  created_at: string;
}


export interface ChapterRevision {
  id: number;
  chapter_id: number;
  novel_id: number;
  title: string;
  content?: string;
  word_count: number;
  reason: string;
  created_at: string;
}

export interface Outline {
  id: number;
  novel_id: number;
  chapter_id: number | null;
  title: string;
  content: string;
  sort_order: number;
  updated_at: string;
}

export interface Character {
  id: number;
  novel_id: number;
  name: string;
  alias: string;
  role: string;
  gender: string;
  age: string;
  appearance: string;
  personality: string;
  background: string;
  relationships: { name: string; relation: string }[];
  sort_order: number;
  updated_at: string;
  state?: {
    character_id: number;
    novel_id: number;
    current_location: string;
    key_relationships: string;
    recent_events: string;
    type_specific_data: string;
    notes: string;
    updated_at: string;
  };
}

export interface MapDoc {
  id: number;
  novel_id: number;
  name: string;
  updated_at: string;
  data: MapData;
}

export interface MapData {
  width: number;
  height: number;
  bg?: string;
  shapes: MapShape[];
  paths: MapPath[];
  labels: MapLabel[];
  markers: MapMarker[];
  lines: MapLine[];
}

export interface MapShape {
  id: string;
  kind: "polygon" | "ellipse";
  name: string;
  points?: number[]; // 多边形顶点（世界坐标）
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  fill: string;
  stroke: string;
}

export interface MapPath {
  id: string;
  name: string;
  points: number[];
  color: string;
  width: number;
  dashed: boolean;
}

export interface MapLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
}

export interface MapMarker {
  id: string;
  characterId: number | null;
  x: number;
  y: number;
  name: string;
  color: string;
}

export interface MapLine {
  id: string;
  fromId: string;
  toId: string;
  color: string;
  dashed: boolean;
  label?: string;
}

export interface DistilledAuthorVersion {
  id: number;
  author_id: number;
  version: number;
  writing_skill: string;
  author_persona: string;
  skill_markdown: string;
  sample_summary: string;
  created_at: string;
}

export interface DistilledAuthorSource {
  id: number;
  author_id: number;
  kind: "novel" | "comment" | "social";
  filename: string;
  format: string;
  size_bytes: number;
  parsed_chars: number;
  chapter_count: number;
  status: "uploading" | "ready" | "error";
  error: string | null;
  created_at: string;
}

export interface DistilledAuthor {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  profile: Record<string, unknown>;
  current_version_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  current_version: DistilledAuthorVersion | null;
}

export interface DistilledAuthorDetail extends DistilledAuthor {
  sources: DistilledAuthorSource[];
  versions: DistilledAuthorVersion[];
}

export interface NovelWriterState {
  novel_id: number;
  user_id: number;
  distilled_author_id: number | null;
  progress: string;
  foreshadowing: string;
  updated_at: string | null;
}
