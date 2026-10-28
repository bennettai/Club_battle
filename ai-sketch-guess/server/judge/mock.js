// Fake judge for testing the game without an API key. JUDGE_PROVIDER=mock.
const REASONS = [
  "Bold lines, clear idea. The judge approves.",
  "I squinted and I can see it!",
  "A brave artistic choice.",
  "Unmistakable. Well, mostly.",
  "Picasso would be confused, and so am I.",
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const entry = () => ({ score: Math.floor(Math.random() * 11), reason: pick(REASONS) });

export async function judgeImages() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { drawingA: entry(), drawingB: entry(), winner: "tie" };
}
