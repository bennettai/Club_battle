import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { judge, providerName } from "./judge/index.js";
import { nextPrompt } from "./prompts.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST_PIN = process.env.HOST_PIN || "";

const COUNTDOWN_MS = 3_000;
const DRAW_MS = 30_000;
const COLLECT_MS = 3_000; // grace period for drawings to arrive after time's up
const MAX_DRAWING_CHARS = 4_000_000;
const PNG_PREFIX = "data:image/png;base64,";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const app = express();
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "host.html")));
app.get("/play", (req, res) => res.sendFile(path.join(publicDir, "play.html")));
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.use(express.static(publicDir));

const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

// One room, held in memory. Fine for a club event; a restart resets it.
const game = {
  code: newRoomCode(),
  phase: "lobby", // lobby | countdown | drawing | collecting | judging | results | error
  round: 0,
  prompt: null,
  endsAt: null,
  players: { 1: null, 2: null }, // socket ids
  drawings: { 1: null, 2: null }, // PNG data URLs
  result: null,
  error: null,
  score: { 1: 0, 2: 0 },
};
let timer = null;

function newRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, they look like 1 and 0
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}

function snapshot(forHost) {
  const state = {
    now: Date.now(),
    phase: game.phase,
    round: game.round,
    prompt: game.prompt,
    endsAt: game.endsAt,
    players: { 1: Boolean(game.players[1]), 2: Boolean(game.players[2]) },
    score: game.score,
    result: game.result,
    error: game.error,
  };
  if (forHost) {
    state.code = game.code;
    if (game.result) state.drawings = game.drawings;
  }
  return state;
}

function broadcast() {
  io.to("hosts").emit("state", snapshot(true));
  io.to("players").emit("state", snapshot(false));
}

function setPhase(phase, durationMs = 0) {
  game.phase = phase;
  game.endsAt = durationMs ? Date.now() + durationMs : null;
  broadcast();
}

function startRound() {
  if (!["lobby", "results", "error"].includes(game.phase)) return "A round is already running.";
  if (!game.players[1] || !game.players[2]) return "Waiting for both players to join.";

  clearTimeout(timer);
  game.round += 1;
  game.prompt = nextPrompt();
  game.drawings = { 1: null, 2: null };
  game.result = null;
  game.error = null;

  setPhase("countdown", COUNTDOWN_MS);
  timer = setTimeout(() => {
    setPhase("drawing", DRAW_MS);
    timer = setTimeout(collectDrawings, DRAW_MS);
  }, COUNTDOWN_MS);
  return null;
}

function collectDrawings() {
  setPhase("collecting");
  io.to("players").emit("submit", { round: game.round });
  timer = setTimeout(runJudge, COLLECT_MS);
}

function maybeFinishCollecting() {
  if (game.phase === "collecting" && game.drawings[1] && game.drawings[2]) {
    clearTimeout(timer);
    runJudge();
  }
}

async function runJudge() {
  const round = game.round;
  setPhase("judging");
  try {
    const strip = (png) => (png ? png.slice(PNG_PREFIX.length) : null);
    const verdict = await judge({
      prompt: game.prompt,
      drawings: { 1: strip(game.drawings[1]), 2: strip(game.drawings[2]) },
    });
    if (round !== game.round) return; // the host reset mid-judging
    game.result = verdict;
    if (verdict.winner !== "tie") game.score[verdict.winner] += 1;
    setPhase("results");
  } catch (err) {
    if (round !== game.round) return;
    console.error("Judging failed:", err);
    game.error = "Judge unavailable. Check the server logs, then retry.";
    setPhase("error");
  }
}

function resetGame() {
  clearTimeout(timer);
  game.round += 1; // invalidates any judging still in flight
  Object.assign(game, {
    phase: "lobby",
    prompt: null,
    endsAt: null,
    drawings: { 1: null, 2: null },
    result: null,
    error: null,
    score: { 1: 0, 2: 0 },
  });
  broadcast();
}

io.on("connection", (socket) => {
  const isHost = () => socket.data.role === "host";

  socket.on("host:join", ({ pin } = {}, ack) => {
    if (HOST_PIN && pin !== HOST_PIN) {
      return ack?.({ ok: false, needPin: true, error: pin ? "Wrong PIN." : "" });
    }
    socket.data.role = "host";
    socket.join("hosts");
    ack?.({ ok: true });
    socket.emit("state", snapshot(true));
  });

  socket.on("host:start", (ack) => {
    if (!isHost()) return;
    const error = startRound();
    ack?.({ ok: !error, error });
  });

  socket.on("host:retry", () => {
    if (isHost() && game.phase === "error") runJudge();
  });

  socket.on("host:reset", () => {
    if (isHost()) resetGame();
  });

  socket.on("player:join", ({ code, slot } = {}, ack) => {
    slot = Number(slot);
    if (String(code ?? "").trim().toUpperCase() !== game.code) {
      return ack?.({ ok: false, error: "Wrong room code." });
    }
    if (slot !== 1 && slot !== 2) return ack?.({ ok: false, error: "Pick Player 1 or Player 2." });

    const holder = game.players[slot];
    // A slot is free if nobody holds it or its holder has dropped off (e.g. an iPad went to sleep).
    if (holder && holder !== socket.id && io.sockets.sockets.has(holder)) {
      return ack?.({ ok: false, error: `Player ${slot} is already taken.` });
    }
    if (socket.data.slot && socket.data.slot !== slot && game.players[socket.data.slot] === socket.id) {
      game.players[socket.data.slot] = null;
    }
    game.players[slot] = socket.id;
    socket.data.slot = slot;
    socket.join("players");
    ack?.({ ok: true, slot });
    broadcast();
  });

  socket.on("player:drawing", ({ round, png } = {}) => {
    const slot = socket.data.slot;
    if (!slot || game.players[slot] !== socket.id) return;
    if (game.phase !== "collecting" || round !== game.round) return;
    if (typeof png !== "string" || !png.startsWith(PNG_PREFIX) || png.length > MAX_DRAWING_CHARS) return;
    game.drawings[slot] = png;
    maybeFinishCollecting();
  });

  socket.on("disconnect", () => {
    const slot = socket.data.slot;
    if (slot && game.players[slot] === socket.id) {
      game.players[slot] = null;
      broadcast();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Sketch Battle on http://localhost:${PORT} (judge: ${providerName()}, room code: ${game.code})`);
});
