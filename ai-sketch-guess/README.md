# Sketch Battle

Two players get the same prompt and have 30 seconds to draw it on their own iPad (or any device with a browser). When time's up, an AI judges both drawings against the prompt, scores each one out of 10 with a one-line reason, and picks the winner.

- **Host screen** (`/`): put this on a laptop or projector. It shows the room code, the prompt, the countdown and the results.
- **Player screen** (`/play`): open this on each iPad, enter the room code, pick Player 1 or Player 2, and draw.

## Run it locally

Needs Node 22+.

```bash
cd ai-sketch-guess
npm install
cp .env.example .env    # then add your API key
npm start               # http://localhost:3000
```

Open `http://localhost:3000` for the host screen and `http://localhost:3000/play` in two more tabs to play both sides.

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

The server runs in Docker. From the repo root:

```bash
docker compose up -d --build
```

On the server, keep the real `.env` at `ai-sketch-guess/.env`. It's gitignored, so API keys never go into the repo.

The game is published on port 3100 on the server (set in `docker-compose.yml`). Put HTTPS in front of it, for example with a Cloudflare Tunnel ingress rule (`service: http://localhost:3100`) or Caddy (`your.domain { reverse_proxy localhost:3100 }`). The game uses WebSockets, so any proxy or load balancer must allow them.

For now, deploy by hand: on the server, `git pull` in the repo and run `docker compose up -d --build`.

Auto-deploy is planned but not added yet: a GitHub Actions workflow at `.github/workflows/deploy.yml` that runs on every push to `main`, SSHes into the server and runs `git pull && docker compose up -d --build`. It will need these repo secrets, which an org owner or repo admin has to add:

- `DEPLOY_HOST`: server address
- `DEPLOY_USER`: SSH user, which must be able to run `docker`
- `DEPLOY_SSH_KEY`: private key for that user, used only for deploys

The workflow will look for the repo in `~/Club_battle` on the server. To use another path, set an Actions variable `DEPLOY_PATH`. Clone the repo there once before the first deploy.

## To do

- [ ] Fix the host UI: make the results screen fit on one screen (smaller drawings, buttons visible) on a laptop or projector without scrolling.
