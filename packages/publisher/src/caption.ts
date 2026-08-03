import { PublisherError } from "./types";

export type CaptionSource = {
  platformPostId: string;
  text: string;
  sourceUrl: string;
  sourceAccount: { username: string; captionTemplate: string | null; attributionTemplate: string | null; hashtagRules: string | null };
};

function interpolate(template: string, source: CaptionSource): string {
  return template
    .replaceAll("{sourceCaption}", source.text.trim())
    .replaceAll("{sourceUsername}", `@${source.sourceAccount.username}`)
    .replaceAll("{sourceUrl}", source.sourceUrl)
    .replaceAll("{postId}", source.platformPostId);
}

function hashtags(value: string | null): string {
  if (!value) return "";
  return [...new Set(value.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag}`))].join(" ");
}

export function resolveCaption(source: CaptionSource, globalTemplates: string): string {
  const templates = source.sourceAccount.captionTemplate
    ? [source.sourceAccount.captionTemplate]
    : globalTemplates.split(/^[ \t]*---[ \t]*\r?$/m).map((template) => template.trim()).filter(Boolean);
  const index = Number.parseInt(source.platformPostId.slice(-6), 10) % Math.max(templates.length, 1);
  const template = templates[index] ?? "{sourceCaption}";
  const attribution = source.sourceAccount.attributionTemplate ? interpolate(source.sourceAccount.attributionTemplate, source) : "";
  return [interpolate(template, source), attribution, hashtags(source.sourceAccount.hashtagRules)].filter(Boolean).join("\n\n").trim();
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
