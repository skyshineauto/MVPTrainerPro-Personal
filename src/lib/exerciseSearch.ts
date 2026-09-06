import { normalizeText } from "./exerciseMatch";

export type SearchableExercise = {
  id: string;
  name?: string | null;
  canonical_name?: string | null;
  source?: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  equipment?: string[] | null;
  [key: string]: any;
};

const TERM_ALIASES: Record<string, string[]> = {
  pulldown: ["pull down"],
  "pull down": ["pulldown"],
  pullup: ["pull up"],
  "pull up": ["pullup"],
  pushup: ["push up"],
  "push up": ["pushup"],
  situp: ["sit up"],
  "sit up": ["situp"],
  stepup: ["step up"],
  "step up": ["stepup"],
  stairmaster: ["stair master", "stair climber", "stepmill"],
  "stair master": ["stairmaster"],
  stepmill: ["step mill", "stairmaster"],
  "step mill": ["stepmill"],
};

function tokens(value: string) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function compact(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function trigrams(value: string) {
  const clean = `  ${normalizeText(value)}  `;
  const out = new Set<string>();
  for (let index = 0; index <= clean.length - 3; index += 1) {
    out.add(clean.slice(index, index + 3));
  }
  return out;
}

function trigramSimilarity(a: string, b: string) {
  const aa = trigrams(a);
  const bb = trigrams(b);
  if (!aa.size || !bb.size) return 0;
  let shared = 0;
  for (const gram of aa) if (bb.has(gram)) shared += 1;
  return (2 * shared) / (aa.size + bb.size);
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function tokenSimilarity(queryToken: string, nameToken: string) {
  if (queryToken === nameToken) return 1;
  if (nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken)) {
    return Math.min(queryToken.length, nameToken.length) / Math.max(queryToken.length, nameToken.length);
  }
  const maxLen = Math.max(queryToken.length, nameToken.length);
  if (maxLen <= 2) return 0;
  const distance = levenshtein(queryToken, nameToken);
  return Math.max(0, 1 - distance / maxLen);
}

function expandQuery(raw: string) {
  const normalized = normalizeText(raw);
  const set = new Set<string>([normalized]);
  for (const [term, aliases] of Object.entries(TERM_ALIASES)) {
    if (!normalized.includes(term)) continue;
    for (const alias of aliases) set.add(normalizeText(normalized.replace(term, alias)));
  }
  return Array.from(set).filter(Boolean);
}

export function scoreExerciseName(name: string, rawQuery: string) {
  const query = normalizeText(rawQuery);
  const candidate = normalizeText(name);
  if (!query) return 1;
  if (!candidate) return 0;

  const variants = expandQuery(rawQuery);
  let best = 0;

  for (const variant of variants) {
    if (candidate === variant) best = Math.max(best, 1000);
    if (compact(candidate) === compact(variant)) best = Math.max(best, 990);
    if (candidate.startsWith(`${variant} `) || candidate.endsWith(` ${variant}`)) best = Math.max(best, 950);
    if (candidate.includes(variant)) best = Math.max(best, 930 - Math.max(0, candidate.length - variant.length) * 0.2);

    const qTokens = tokens(variant);
    const nTokens = tokens(candidate);
    if (qTokens.length) {
      const exactTokenHits = qTokens.filter((token) => nTokens.includes(token)).length;
      if (exactTokenHits === qTokens.length) {
        best = Math.max(best, 900 + Math.min(40, qTokens.length * 4));
      }

      let fuzzyTotal = 0;
      let fuzzyPass = true;
      for (const qToken of qTokens) {
        let tokenBest = 0;
        for (const nToken of nTokens) tokenBest = Math.max(tokenBest, tokenSimilarity(qToken, nToken));
        fuzzyTotal += tokenBest;
        if (tokenBest < 0.66) fuzzyPass = false;
      }
      if (fuzzyPass) {
        const average = fuzzyTotal / qTokens.length;
        best = Math.max(best, 690 + average * 180);
      }
    }

    const trigram = trigramSimilarity(variant, candidate);
    if (trigram >= 0.32) best = Math.max(best, 540 + trigram * 250);
  }

  return best;
}

export function rankExercises<T extends SearchableExercise>(rows: T[], rawQuery: string): T[] {
  const query = normalizeText(rawQuery);
  if (!query) return rows.slice().sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  return rows
    .map((row, index) => {
      const names = [String(row.name ?? ""), String(row.canonical_name ?? "")].filter(Boolean);
      const score = names.length ? Math.max(...names.map((name) => scoreExerciseName(name, rawQuery))) : 0;
      return { row, index, score };
    })
    .filter((entry) => entry.score >= 620)
    .sort((a, b) => b.score - a.score || String(a.row.name ?? "").localeCompare(String(b.row.name ?? "")) || a.index - b.index)
    .map((entry) => entry.row);
}
