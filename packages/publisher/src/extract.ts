export type CaptionNames = { character: string | null; artist: string | null };

const TITLE_PREFIX = /^(?:title-|《|>>)/i;
const BY_LINE = /^by\s*[-:—]\s*(.+)$/i;
const BY_TAIL = /\bby\s*[-:]\s*([^\s]+)\s*$/i;
const VA_LINE = /^(.+?)\s+VA-@?([^\s]+)$/i;
const ANIMATION_BY = /^(?:animation|anim)\s*b*y?\s*-\s*@?\s*([^\s]+)$/i;
const HANDLE_LINE = /^@([^\s]+)$/;
const CREDIT_LINE = new RegExp(
  [
    "^by\\b",
    "^(?:animation|sfx|model|map|room|audio|voice|type\\d*|compilation|com|illustration|script|direct(?:ed)?|edit)\\b",
    "\\bby\\s*[-:]",
    "\\bVA-@",
    "^sd\\s*:",
    "^@",
    "https?://",
    "^>>",
    "^《",
  ].join("|"),
  "i",
);
const GENERIC_CHARACTER = /^(?:male|female|narrator|everyone|them|other|type\d*|sfx|model|room|audio|voice)$/i;

function isGenericCharacter(value: string): boolean {
  return GENERIC_CHARACTER.test(value.trim());
}

function collapse(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/^[\s"'“‘[{(]+/, "")
    .replace(/[\s"'”’\])}]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value: string): string {
  const text = collapse(value).replace(/[\s.,;:!?]+$/, "").trim();
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  if (opens > closes) return `${text})`;
  if (closes > opens) return text.replace(/^\)+/, "");
  return text;
}

function looksLikeName(value: string): boolean {
  const text = collapse(value);
  if (text.length < 2 || text.length > 48) return false;
  if (!/[a-z]/i.test(text)) return false;
  if (TITLE_PREFIX.test(text)) return false;
  if (/[.!?;:,]["”']?$/.test(text)) return false;
  if (/https?:\/\//.test(text) || text.includes("@")) return false;
  if (text.split(/\s+/).length > 3) return false;
  if (isGenericCharacter(text)) return false;
  return true;
}

function characterCandidates(line: string): string[] {
  const candidates: string[] = [];
  for (const separator of [/\s+[-–—]\s+/, /\s*:\s+/, /\s*\(/]) {
    const head = line.split(separator)[0];
    if (head && head !== line) candidates.push(head);
  }
  candidates.push(line);
  if (line.includes("&")) candidates.push(...line.split(/\s*&\s*/));
  return candidates.filter((value) => value.trim().length > 0);
}

function pickCharacter(line: string): string | null {
  for (const candidate of characterCandidates(line)) if (looksLikeName(candidate)) return cleanName(candidate);
  return null;
}

function handle(value: string): string | null {
  return value.replace(/^[@/\s]+/, "").trim() || null;
}

export function extractCaptionNames(text: string, sourceUsername: string): CaptionNames {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { character: null, artist: null };
  if (TITLE_PREFIX.test(lines[0])) return { character: null, artist: null };

  let character: string | null = null;
  let artist: string | null = null;
  let artistLine: string | null = null;

  for (const line of lines) {
    const byLine = BY_LINE.exec(line);
    if (byLine) { artist ??= cleanName(byLine[1]) || null; artistLine ??= line; continue; }
    const animationBy = ANIMATION_BY.exec(line);
    if (animationBy) { artist ??= handle(animationBy[1]); artistLine ??= line; continue; }
    const vaLine = VA_LINE.exec(line);
    if (vaLine) {
      const name = cleanName(vaLine[1]);
      if (name && !isGenericCharacter(name)) character ??= name;
      artist ??= handle(vaLine[2]);
      artistLine ??= line;
      continue;
    }
    if (sourceUsername !== "master_uwurr" && HANDLE_LINE.test(line)) { artist ??= handle(line.slice(1)); artistLine ??= line; continue; }
    const byTail = BY_TAIL.exec(line);
    if (byTail && !byTail[1].startsWith("(")) { artist ??= handle(byTail[1]); artistLine ??= line; continue; }
  }

  if (!artist && sourceUsername === "master_uwurr") {
    const second = lines[1];
    if (second
      && !/https?:\/\//.test(second)
      && !second.includes("@")
      && !/\bAI$/i.test(second)
      && !CREDIT_LINE.test(second)
      && looksLikeName(second)) { artist = cleanName(second); artistLine = second; }
  }

  if (!character) {
    // The credit sits on line 1 for kitagawapost/master_uwurr and on line 0 for nitlali,
    // so the character can only ever come from the first two non-empty lines. Anything
    // further down is promo copy (handles, brand URLs) and must never become the caption.
    for (const line of lines.slice(0, 2)) {
      if (CREDIT_LINE.test(line) || line === artistLine) continue;
      const candidate = pickCharacter(line);
      if (candidate) { character = candidate; break; }
    }
  }

  return { character, artist };
}
