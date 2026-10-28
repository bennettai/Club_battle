const socket = io();
const $ = (id) => document.getElementById(id);

const EXPORT_WIDTH = 768;
const INK = "#111111";
const PAPER = "#ffffff";

let joined = null; // { code, slot }
let state = null;
let clockOffset = 0;
let lastRound = 0;

// ---------- Joining ----------

try {
  const saved = JSON.parse(sessionStorage.getItem("player") || "null");
  if (saved) $("code").value = saved.code;
} catch {}

function join(code, slot) {
  socket.emit("player:join", { code, slot }, (res) => {
    if (!res.ok) {
      joined = null;
      $("join-error").textContent = res.error;
      $("join-view").classList.remove("hidden");
      $("draw-view").classList.add("hidden");
      return;
    }
    joined = { code, slot: res.slot };
    try { sessionStorage.setItem("player", JSON.stringify(joined)); } catch {}
    $("join-error").textContent = "";
    $("join-view").classList.add("hidden");
    $("draw-view").classList.remove("hidden");
    $("me").textContent = `Player ${res.slot}`;
    $("me").className = `p${res.slot}`;
    fitCanvas();
  });
}

$("join-view").addEventListener("submit", (e) => {
  e.preventDefault();
  join($("code").value.trim().toUpperCase(), Number(e.submitter.value));
});

// Rejoin the same slot after a dropped connection (e.g. the iPad slept).
socket.on("connect", () => {
  if (joined) join(joined.code, joined.slot);
});

// ---------- Game state ----------

socket.on("state", (s) => {
  state = s;
  clockOffset = s.now - Date.now();
  if (s.round !== lastRound && s.phase === "countdown") {
    lastRound = s.round;
    clearCanvas();
  }
  render();
});

socket.on("submit", ({ round }) => {
  socket.emit("player:drawing", { round, png: exportPng() });
});

function render() {
  const s = state;
  $("prompt").textContent = s.prompt && s.phase !== "lobby" ? s.prompt : "";

  let message = "";
  if (s.phase === "lobby") message = "Waiting for the host to start…";
  else if (s.phase === "countdown") message = `Get ready to draw: ${s.prompt}`;
  else if (s.phase === "collecting" || s.phase === "judging") message = "Pencils down! The judge is looking…";
  else if (s.phase === "results") message = resultMessage();
  else if (s.phase === "error") message = "The judge is having trouble. Hang on…";

  $("overlay").textContent = message;
  $("overlay").classList.toggle("hidden", s.phase === "drawing");
}

function resultMessage() {
  const { result } = state;
  const mine = result.players[joined.slot];
  const score = mine.score === null ? "" : ` You scored ${mine.score}/10.`;
  if (result.winner === "tie") return `It's a tie!${score}`;
  return (result.winner === joined.slot ? "You win!" : "You lose this one.") + score;
}

function tick() {
  if (state && state.endsAt) {
    const left = Math.max(0, state.endsAt - (Date.now() + clockOffset));
    $("timer").textContent = Math.ceil(left / 1000);
  } else {
    $("timer").textContent = "";
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- Drawing ----------

const canvas = $("pad");
const ctx = canvas.getContext("2d");
let tool = { kind: "pen", size: 4 };
let last = null;

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (!width || !height || (canvas.width === width && canvas.height === height)) return;

  // Keep what's already drawn when the iPad rotates.
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);

  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(copy, 0, 0);
}
window.addEventListener("resize", fitCanvas);

function clearCanvas() {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

const canDraw = () => state && state.phase === "drawing";

function point(e) {
  const rect = canvas.getBoundingClientRect();
  const dpr = canvas.width / rect.width;
  return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr, dpr };
}

function strokeTo(p) {
  ctx.strokeStyle = tool.kind === "eraser" ? PAPER : INK;
  ctx.lineWidth = tool.size * p.dpr;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  last = p;
}

canvas.addEventListener("pointerdown", (e) => {
  if (!canDraw()) return;
  canvas.setPointerCapture(e.pointerId);
  last = point(e);
  strokeTo({ ...last, x: last.x + 0.01 }); // a tap leaves a dot
});

canvas.addEventListener("pointermove", (e) => {
  if (!last || !canDraw()) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) strokeTo(point(ev));
});

const endStroke = () => { last = null; };
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

document.querySelectorAll("[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    tool = { kind: btn.dataset.tool, size: Number(btn.dataset.size) };
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

$("clear-btn").addEventListener("click", () => {
  if (canDraw()) clearCanvas();
});

function exportPng() {
  const scale = Math.min(1, EXPORT_WIDTH / canvas.width);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const o = out.getContext("2d");
  o.fillStyle = PAPER;
  o.fillRect(0, 0, out.width, out.height);
  o.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
