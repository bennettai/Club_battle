// Provider-neutral judge. The game calls judge(); each AI provider is a small
// adapter in this folder exporting judgeImages(). Switch with JUDGE_PROVIDER.
import { z } from "zod";

const PROVIDERS = {
  gemini: () => import("./gemini.js"),
  claude: () => import("./claude.js"),
  ollama: () => import("./ollama.js"),
  mock: () => import("./mock.js"),
};

// Local models can be slow, so this is adjustable.
const TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS) || 20_000;

const Entry = z.object({
  score: z.number().int().min(0).max(10),
  reason: z.string(),
});

export const VerdictSchema = z.object({
  drawingA: Entry,
  drawingB: Entry,
  winner: z.enum(["A", "B", "tie"]),
});

const verdictJsonSchema = z.toJSONSchema(VerdictSchema);

function instructionsFor(prompt) {
  return [
    "You are the judge of a quick-draw battle between two players.",
    `Both players had 30 seconds to draw: "${prompt}".`,
    "You will see Drawing A and Drawing B.",
    "Score each drawing from 0 to 10 for how well it shows the prompt. These are 30-second sketches, so judge how recognisable it is, not artistic skill. Use this scale:",
    "- 0: blank, or nothing to do with the prompt.",
    "- 1-3: hard to tell it's meant to be the prompt.",
    "- 4-6: you can tell what it is, but only just, or it's missing something essential.",
    "- 7-8: clearly the prompt at a glance.",
    "- 9: clearly the prompt and has extra detail or character that makes it stand out.",
    "- 10: exceptional for 30 seconds. Rare.",
    "Most decent sketches land around 6-8. Score each drawing on its own merits first, then make sure the gap between the two scores reflects how different they really are.",
    "For each drawing, give one short, fun, family-friendly sentence explaining its score.",
    'Set winner to "A" or "B" for the higher score, or "tie" only if the scores are equal.',
  ].join("\n");
}

export function providerName() {
  return (process.env.JUDGE_PROVIDER || "gemini").toLowerCase();
}

async function loadProvider() {
  const name = providerName();
  const load = PROVIDERS[name];
  if (!load) {
    throw new Error(`Unknown JUDGE_PROVIDER "${name}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return load();
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Judge timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function askProvider(provider, request) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await withTimeout(provider.judgeImages(request), TIMEOUT_MS);
      return VerdictSchema.parse(raw);
    } catch (err) {
      lastError = err;
      console.error(`Judge attempt ${attempt} failed:`, err.message);
    }
  }
  throw lastError;
}

// drawings: { 1: base64 PNG or null, 2: base64 PNG or null }
// Returns { players: { 1: { score, reason }, 2: { score, reason } }, winner: 1 | 2 | "tie" }
export async function judge({ prompt, drawings }) {
  const [d1, d2] = [drawings[1], drawings[2]];

  if (!d1 && !d2) {
    const none = { score: 0, reason: "No drawing arrived." };
    return { players: { 1: none, 2: none }, winner: "tie" };
  }
  if (!d1 || !d2) {
    const present = d1 ? 1 : 2;
    const missing = present === 1 ? 2 : 1;
    return {
      players: {
        [present]: { score: null, reason: "Wins by default: the other drawing never arrived." },
        [missing]: { score: 0, reason: "No drawing arrived." },
      },
      winner: present,
    };
  }

  // Randomise which player is "A" so the model can't favour a position.
  const swapped = Math.random() < 0.5;
  const [playerA, playerB] = swapped ? [2, 1] : [1, 2];

  const provider = await loadProvider();
  const verdict = await askProvider(provider, {
    instructions: instructionsFor(prompt),
    imageA: drawings[playerA],
    imageB: drawings[playerB],
    jsonSchema: verdictJsonSchema,
    zodSchema: VerdictSchema,
  });

  const players = { [playerA]: verdict.drawingA, [playerB]: verdict.drawingB };
  const s1 = players[1].score;
  const s2 = players[2].score;
  // Scores decide the winner, so the badge always matches the numbers.
  const winner = s1 === s2 ? "tie" : s1 > s2 ? 1 : 2;
  return { players, winner };
}
