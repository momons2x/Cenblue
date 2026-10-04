import { extractCaptionNames } from "./extract";
import { resolveFranchise } from "./franchise-map";
import { PublisherError } from "./types";

export type CaptionSource = {
  platformPostId: string;
  text: string;
  sourceUrl: string;
  sourceAccount: { username: string; captionTemplate: string | null; attributionTemplate: string | null; hashtagRules: string | null };
};

export const CAPTION_PLACEHOLDERS = [
  "{character}", "{artist}", "{follow}", "{franchise}", "{reaction}", "{tags}",
  "{sourceCaption}", "{sourceUsername}", "{sourceUrl}", "{postId}",
] as const;

const TEMPLATE_SPLIT = /^[ \t]*---[ \t]*\r?$/m;
const MAX_CAPTION = 280;
const MAX_TAGS = 6;

const BASE_TAGS = ["#nsfw", "#2danim", "#3danim", "#r34"];
const REDUCED_TAGS = ["#nsfw", "#r34"];
const FLAVOUR_TAGS = ["#anime", "#3d", "#mmd", "#render", "#otokonoko", "#gacha"];

// Fires on roughly one post in ten and never replaces the character or `by` line.
const REACTIONS = [
  "she knows you're watching",
  "keep going, it gets worse",
  "this one's my favourite",
  "don't scroll past this one",
  "you weren't supposed to see this",
  "watch it twice, she doesn't mind",
  "one more and you're done, promise",
  "already thinking about the next one",
];

type Values = Record<string, string>;

function hash(value: string): number {
  let current = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    current ^= value.charCodeAt(index);
    current = Math.imul(current, 16777619);
  }
  return current >>> 0;
}

function interpolate(template: string, values: Values): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "");
}

function isConnector(value: string): boolean {
  const text = value.trim();
  if (text === "") return true;
  return /^(?:(?:anim(?:ation)?\s+)?by|from)\s*[-:]?\s*$/i.test(text) || /^[—–\-:→]+$/.test(text);
}

function renderBlocks(template: string, values: Values): string {
  const blocks: string[] = [];
  for (const raw of template.split(/\r?\n[ \t]*\r?\n/)) {
    const lines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const substituted = interpolate(line, values);
      if (/\{\w+\}/.test(line) && isConnector(substituted)) continue;
      lines.push(substituted);
    }
    const block = lines.join("\n").trim();
    if (block) blocks.push(block);
  }
  return blocks.join("\n\n");
}

function splitTags(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)))];
}

function slugTag(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug ? `#${slug}` : "";
}

function tagBlock(source: CaptionSource, character: string | null, franchiseSlug: string | null, hashtagRules: string | null): string {
  const roll = hash(`${source.platformPostId}#tags`) % 10;
  if (roll === 0) return "";
  const base = roll <= 4 ? BASE_TAGS : roll <= 6 ? REDUCED_TAGS : roll === 7 ? [] : REDUCED_TAGS;
  const pool = [...base];
  if (roll >= 8) pool.push(FLAVOUR_TAGS[hash(`${source.platformPostId}#flavour`) % FLAVOUR_TAGS.length]);
  if (character) pool.push(slugTag(character));
  if (franchiseSlug) pool.push(`#${franchiseSlug}`);
  pool.push(...splitTags(hashtagRules));
  return [...new Set(pool.filter(Boolean))].slice(0, MAX_TAGS).join(" ");
}

function reactionFor(source: CaptionSource, character: string | null): string {
  if (!character) return "";
  if (hash(`${source.platformPostId}rx`) % 10 !== 0) return "";
  return REACTIONS[hash(`${source.platformPostId}rx#`) % REACTIONS.length];
}

function truncate(value: string, max: number): string {
  const characters = Array.from(value);
  if (characters.length <= max) return value;
  const cut = characters.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).join("").trim();
}

// Last resort when the template rendered nothing: the raw source text with promo noise
// removed. Title markers are stripped too — `Title- … 《Episode 1》&` is a title, not a caption.
function fallbackCaption(source: CaptionSource): string {
  const text = source.text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/>>[^<]*<</g, " ")
    .replace(/^\s*title-\s*/i, "")
    .replace(/《[^》]*》/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\(new\)\s*$/i, "")
    .replace(/[\s&]+$/, "")
    .trim();
  return truncate(text, MAX_CAPTION);
}

function fitCaption(preferred: string, shorter: string): string {
  if (Array.from(preferred).length <= MAX_CAPTION) return preferred;
  if (Array.from(shorter).length <= MAX_CAPTION) return shorter;
  return truncate(shorter, MAX_CAPTION);
}

export function resolveCaption(source: CaptionSource, globalTemplates: string): string {
  const names = extractCaptionNames(source.text, source.sourceAccount.username);
  const franchise = resolveFranchise(names.character);
  const reaction = reactionFor(source, names.character);
  const tags = tagBlock(source, names.character, franchise?.slug ?? null, source.sourceAccount.hashtagRules);

  const templates = source.sourceAccount.captionTemplate
    ? [source.sourceAccount.captionTemplate]
    : globalTemplates.split(TEMPLATE_SPLIT).map((template) => template.trim()).filter(Boolean);
  const selector = Number.parseInt(source.platformPostId.slice(-6), 10);
  const index = Number.isFinite(selector) && templates.length > 0 ? Math.abs(selector) % templates.length : 0;
  const template = templates[index] ?? "{sourceCaption}";

  const values: Values = {
    sourceCaption: source.text.trim(),
    sourceUsername: `@${source.sourceAccount.username}`,
    sourceUrl: source.sourceUrl,
    postId: source.platformPostId,
    character: names.character ?? "",
    artist: names.artist ?? "",
    franchise: franchise?.name ?? "",
    follow: names.artist ? "Follow em!!" : "",
    reaction,
    tags,
  };

  const attribution = source.sourceAccount.attributionTemplate ? interpolate(source.sourceAccount.attributionTemplate, values).trim() : "";
  const core = [renderBlocks(template, { ...values, tags: "" }), attribution].filter(Boolean).join("\n\n").trim();
  if (!core) return fallbackCaption(source);
  const caption = [renderBlocks(template, values), attribution].filter(Boolean).join("\n\n").trim();
  return fitCaption(caption || core, core);
}

export function validateCaption(caption: string, allowEmpty: boolean): string {
  const normalized = caption.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new PublisherError("INVALID_CAPTION", "Publish caption cannot be empty", false, false);
  }
  if (Array.from(normalized).length > 280) {
    throw new PublisherError("INVALID_CAPTION", "Publish caption exceeds 280 characters", false, false);
  }
  return normalized;
}
