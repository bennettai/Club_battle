const socket = io();
const $ = (id) => document.getElementById(id);

let state = null;
let clockOffset = 0; // server time minus local time

$("join-url").textContent = `${location.host}/play`;

function joinAsHost(pin) {
  socket.emit("host:join", { pin }, (res) => {
    if (res.ok) {
      $("pin-form").classList.add("hidden");
      $("pin-error").textContent = "";
      $("host-view").classList.remove("hidden");
    } else {
      $("pin-form").classList.remove("hidden");
      $("pin-error").textContent = res.error || "";
    }
  });
}

let savedPin = "";
try { savedPin = sessionStorage.getItem("hostPin") || ""; } catch {}

socket.on("connect", () => joinAsHost(savedPin));

$("pin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  savedPin = $("pin").value;
  try { sessionStorage.setItem("hostPin", savedPin); } catch {}
  joinAsHost(savedPin);
});

$("start-btn").addEventListener("click", () => {
  socket.emit("host:start", (res) => {
    $("host-error").textContent = res.ok ? "" : res.error;
  });
});
$("retry-btn").addEventListener("click", () => socket.emit("host:retry"));
$("reset-btn").addEventListener("click", () => {
  if (confirm("Reset the scores and end the current round?")) socket.emit("host:reset");
});

socket.on("state", (s) => {
  state = s;
  clockOffset = s.now - Date.now();
  render();
});

const LABELS = {
  lobby: "Get ready",
  countdown: "Get ready to draw",
  drawing: "Draw!",
  collecting: "Pencils down",
  judging: "The judge is thinking…",
  results: "Results",
  error: "Something went wrong",
};

function render() {
  const s = state;
  $("room-code").textContent = s.code;
  $("scoreline").innerHTML =
    `<span class="p1">P1 ${s.score[1]}</span> – <span class="p2">${s.score[2]} P2</span>`;

  for (const slot of [1, 2]) {
    const pill = $(`pill-${slot}`);
    pill.classList.toggle("joined", s.players[slot]);
    pill.textContent = `Player ${slot}${s.players[slot] ? "" : " (not joined)"}`;
  }

  const bothJoined = s.players[1] && s.players[2];
  $("stage-label").textContent =
    s.phase === "lobby" && !bothJoined ? "Waiting for players" : LABELS[s.phase];
  $("stage-prompt").textContent = s.prompt ? s.prompt : "";

  const canStart = ["lobby", "results", "error"].includes(s.phase);
  $("start-btn").disabled = !canStart || !bothJoined;
  $("start-btn").textContent = s.round > 0 ? "Next round" : "Start round";
  $("retry-btn").classList.toggle("hidden", s.phase !== "error");
  $("host-error").textContent = s.phase === "error" ? s.error : "";

  renderResults();
}

function renderResults() {
  const s = state;
  const show = s.phase === "results" && s.result;
  $("results").classList.toggle("hidden", !show);
  if (!show) return;

  for (const slot of [1, 2]) {
    const card = $(`card-${slot}`);
    const entry = s.result.players[slot];
    const drawing = s.drawings && s.drawings[slot];
    const img = card.querySelector("img");
    img.classList.toggle("hidden", !drawing);
    if (drawing) img.src = drawing;
    card.querySelector(".score").textContent = entry.score === null ? "—" : `${entry.score}/10`;
    card.querySelector(".reason").textContent = entry.reason;
    const won = s.result.winner === slot;
    card.classList.toggle("winner", won);
    card.querySelector(".badge").textContent =
      won ? "Winner!" : s.result.winner === "tie" ? "Tie" : "";
  }
}

function tick() {
  if (state && state.endsAt) {
    const left = Math.max(0, state.endsAt - (Date.now() + clockOffset));
    $("stage-timer").textContent = Math.ceil(left / 1000);
  } else {
    $("stage-timer").textContent = "";
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
