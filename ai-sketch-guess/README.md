# Sketch Battle

Two players get the same prompt and have 30 seconds to draw it on their own iPad (or any device with a browser). When time's up, an AI judges both drawings against the prompt, scores each one out of 10 with a one-line reason, and picks the winner.

- **Host screen** (`/`): put this on a laptop or projector. It shows the room code, the prompt, the countdown and the results.
- **Player screen** (`/play`): open this on each iPad, enter the room code, pick Player 1 or Player 2, and draw.

## Quick start (first time)

You need one computer to run the game, plus up to two more devices (iPads, phones or laptops) for the players. Every device must be on the same Wi-Fi.

1. **Install [Node.js](https://nodejs.org) 22 or newer** on the computer that will run the game. Check with `node --version`.
2. **Get the code:**
   ```bash
   git clone https://github.com/bennettai/Club_battle.git
   cd Club_battle/ai-sketch-guess
   npm install
   ```
3. **Pick an AI judge.** Copy the settings file:
   ```bash
   cp .env.example .env
   ```
   Then open `.env` in a text editor and choose one:
   - **Gemini (cloud):** get a free key at [Google AI Studio](https://aistudio.google.com/apikey) and paste it after `GEMINI_API_KEY=`.
   - **Ollama (free, runs on your computer):** set `JUDGE_PROVIDER=ollama` and follow [Using Ollama](#using-ollama) below.
   - **Just testing:** set `JUDGE_PROVIDER=mock`. Scores are random and no AI is used.
4. **Start the game:**
   ```bash
   npm start
   ```
   The terminal prints the room code, for example `room code: JRYU`.
5. **Open the screens:**
   - Host screen, on the computer or projector: `http://localhost:3000`
   - Player screens: find the computer's local IP (on a Mac: `ipconfig getifaddr en0`; on Windows: `ipconfig`), then open `http://<that-ip>:3000/play` on each player's device. Enter the room code and pick Player 1 or Player 2.
   - No second device? Open `http://localhost:3000/play` in two more browser tabs and play both sides.
6. Press **Start** on the host screen. Players get 3 seconds, then 30 seconds to draw, then the judge scores both drawings.

If the iPads can't load the page, check that they're on the same Wi-Fi as the computer, and that its firewall allows incoming connections for `node`.

To stop the game, press `Ctrl+C` in the terminal.

## Using Ollama

[Ollama](https://ollama.com) runs AI models on your own computer, so judging is free and nothing is sent to the internet. It's slower than Gemini (about 15-25 seconds per round on a good machine) and needs a fairly powerful computer: `gemma4:12b` needs about 10 GB of free memory.

1. Install Ollama from [ollama.com/download](https://ollama.com/download) and open it.
2. Download the model (a one-time download of several GB):
   ```bash
   ollama pull gemma4:12b
   ```
3. In `.env`, set:
   ```
   JUDGE_PROVIDER=ollama
   OLLAMA_MODEL=gemma4:12b
   JUDGE_TIMEOUT_MS=60000
   ```
4. Check it works: `npm run judge:test`. It should give the sun a high score and the square a low one. The first run is slower because the model has to load.

Other models we tested, all of which judged correctly (speeds from one Mac, so yours will differ):

| Model | Speed per round | Notes |
|---|---|---|
| `gemma4:12b` | 16-25s | Recommended. Most consistent scores. |
| `gemma4:e4b` | 11-20s | Fastest and needs less memory, but scores are a bit less reliable. |
| `nemotron-3.5-bolt:e4b` | 17-22s | |
| `qwen3.5:9b` | 20-46s | Slowest. |

Any Ollama model works if it accepts images. Check with `ollama show <model>` and look for "vision".

If the game runs in Docker and Ollama on the same machine, set `OLLAMA_HOST=http://host.docker.internal:11434`.

## Choosing the AI judge

Set `JUDGE_PROVIDER` in `.env`:

| Value | Needs | Notes |
|---|---|---|
| `gemini` (default) | `GEMINI_API_KEY` | Model set by `GEMINI_MODEL` (default `gemini-3.8-flash`) |
| `claude` | `ANTHROPIC_API_KEY` | Model set by `CLAUDE_MODEL` (default `claude-opus-5-5`) |
| `ollama` | [Ollama](https://ollama.com) running with an image-capable model | Free and local. Model set by `OLLAMA_MODEL` (default `gemma4:12b`). Inside Docker, set `OLLAMA_HOST=http://host.docker.internal:11434`. Local models are slower, so raise `JUDGE_TIMEOUT_MS` if rounds time out. |
| `mock` | nothing | Random scores, no API call. For testing the game. |

Check the judge on its own with `npm run judge:test`. It sends a drawing of a sun and a square for the prompt "sun" and prints the verdict.

To add another provider, add a file in `server/judge/` that exports `judgeImages({ instructions, imageA, imageB, jsonSchema, zodSchema })` and returns `{ drawingA: { score, reason }, drawingB: { score, reason }, winner }`, then register it in `server/judge/index.js`.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `JUDGE_PROVIDER` | `gemini` | Which AI judges |
| `JUDGE_TIMEOUT_MS` | `20000` | How long to wait for the judge before retrying once |
| `HOST_PIN` | empty | If set, the host screen asks for this PIN, so strangers who find the URL can't run the game |
| `PORT` | `3000` | Port the server listens on |

## Deploying

To host the game on any machine with Docker, clone the repo, create `ai-sketch-guess/.env` (see [Quick start](#quick-start-first-time)), then run this from the repo root:

```bash
docker compose up -d --build
```

The `.env` file is gitignored, so API keys never go into the repo.

The game is published on port 3100 (set in `docker-compose.yml`; change it if that port is taken). To make it reachable over the internet, put HTTPS in front of it, for example with a Cloudflare Tunnel ingress rule (`service: http://localhost:3100`) or Caddy (`your.domain { reverse_proxy localhost:3100 }`). The game uses WebSockets, so any proxy or load balancer must allow them.

To update a running copy, `git pull` in the repo and run `docker compose up -d --build` again.

Auto-deploy is planned but not added yet: a GitHub Actions workflow at `.github/workflows/deploy.yml` that runs on every push to `main`, SSHes into the host machine and runs `git pull && docker compose up -d --build`. It will need these repo secrets, which an org owner or repo admin has to add:

- `DEPLOY_HOST`: address of the host machine
- `DEPLOY_USER`: SSH user, which must be able to run `docker`
- `DEPLOY_SSH_KEY`: private key for that user, used only for deploys

The workflow will look for the repo in `~/Club_battle` on the host machine. To use another path, set an Actions variable `DEPLOY_PATH`. Clone the repo there once before the first deploy.

## To do

- [ ] Fix the host UI: make the results screen fit on one screen (smaller drawings, buttons visible) on a laptop or projector without scrolling.
