// Sends two generated drawings to the configured judge and prints the verdict.
// Usage: npm run judge:test   (uses JUDGE_PROVIDER from .env, default gemini)
import "dotenv/config";
import { deflateSync, crc32 } from "node:zlib";
import { judge, providerName } from "../server/judge/index.js";

const WIDTH = 400;
const HEIGHT = 300;

// Draw black shapes on a white canvas and encode them as a PNG (no image library needed).
function drawing(isInk) {
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT, 255);
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (WIDTH * 3 + 1)] = 0; // PNG filter byte: none
    for (let x = 0; x < WIDTH; x++) {
      if (isInk(x, y)) raw.fill(0, y * (WIDTH * 3 + 1) + 1 + x * 3, y * (WIDTH * 3 + 1) + 4 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

// Player 1: a sun (circle outline with rays). Player 2: a plain square.
const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const sun = drawing((x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  if (Math.abs(d - 60) < 4) return true;
  const angle = Math.atan2(y - cy, x - cx);
  const onRay = Math.abs(Math.sin(angle * 4)) < 0.06;
  return onRay && d > 80 && d < 130;
});
const square = drawing((x, y) => {
  const inOuter = Math.abs(x - cx) < 70 && Math.abs(y - cy) < 70;
  const inInner = Math.abs(x - cx) < 64 && Math.abs(y - cy) < 64;
  return inOuter && !inInner;
});

console.log(`Judge: ${providerName()}  Prompt: "sun"  (Player 1 drew a sun, Player 2 drew a square)`);
const started = Date.now();
const verdict = await judge({ prompt: "sun", drawings: { 1: sun, 2: square } });
console.log(JSON.stringify(verdict, null, 2));
console.log(`Took ${((Date.now() - started) / 1000).toFixed(1)}s`);
