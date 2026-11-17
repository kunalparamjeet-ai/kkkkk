# VEKTOR AI

Production-oriented full-stack AI software orchestration platform with multi-model task delegation, a split-screen engineering workspace, an OpenAI-compatible VEKTOR API Gateway, GitHub repository synchronization, first-party managed hosting with custom domain verification, credit wallet accounting, billing (Razorpay & Stripe), and a role-based Admin Dashboard.

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Motion, Lucide Icons, JSZip. Deployable to **Netlify** (`netlify.toml`) or served directly by the Express server.
- **Backend**: Node.js, Express, TypeScript (`server.ts` + `/server/*`). Deployable to **Render** (`render.yaml`).
- **Database**: PostgreSQL schema and seed migrations (`/db/migrations/001_initial_schema.sql`, `/db/seed.sql`) using `pg` when `DATABASE_URL` is configured, with automatic atomic file-backed persistence (`.data/vektor-store.json`) in local/container environments without external Postgres.
- **AI Engine Layer (`/server/engine/*`)**: Provider-independent model engine cleanly decoupled from the API Gateway, customer authentication, and billing system:
  - **Self-Hosted Open-Source Engine**: Connects to any OpenAI-compatible or Ollama local/remote inference server (`VEKTOR_INFERENCE_URL`, e.g., vLLM, Ollama, llama.cpp, SGLang, TGI) with live health probing, model auto-discovery, optional weights verification, and zero third-party API keys required when active. Never pretends a self-hosted model is installed or running when unconfigured (`503 self_hosted_not_configured`).
  - **Managed Cloud Engine Adapters**: Server-side `@google/genai` and OpenAI-compatible upstream adapters (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`) kept strictly private on the backend.
- **Background Jobs & Streaming**: Persistent job queue with step-level checkpoints, credit-exhaustion pause/resume, abort support, and real-time Server-Sent Events (`/api/jobs/:jobId/stream`).

## Local Development

1. Copy `.env.example` to `.env` and fill in your server secrets:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the full-stack server on port `3000`:
   ```bash
   npm run dev
   ```

## OAuth Callback URLs

Configure these exact callback URLs in your OAuth provider dashboards:

### GitHub OAuth (`https://github.com/settings/developers`)
- `<APP_URL>/api/github/callback`

### Google OAuth (`https://console.cloud.google.com/apis/credentials`)
- `<APP_URL>/api/auth/google/callback`

## Seeded Accounts (Development / Evaluation)

- **Super Admin**: `superadmin@vektor.ai` / `VektorSuperAdmin!2026`
- **Admin**: `admin@vektor.ai` / `VektorAdmin!2026`
- **Standard Builder**: `builder@vektor.ai` / `VektorBuilder!2026`

## Deployment

### Render (Backend + PostgreSQL + Redis)
1. Push this repository to GitHub.
2. Create a new Blueprint in Render using `render.yaml`.
3. Run `/db/migrations/001_initial_schema.sql` and `/db/seed.sql` against your provisioned PostgreSQL instance.
4. Set `GEMINI_API_KEY`, optional `VEKTOR_INFERENCE_URL`, OAuth credentials, and billing secrets in Render environment variables.

### Netlify (Frontend)
1. Connect the repository to Netlify (`netlify.toml` sets `npm run build` and `dist`).
2. Update the backend target URL in `netlify.toml` if your Render service name differs.

## VEKTOR API Key Management & Gateway

- **Developer API Dashboard**: `/api-gateway` and `/api-docs` — create SHA-256 hashed `vk_live_...` keys with permission scopes (`chat.completions`, `embeddings`, `models.read`, `usage.read`), expiration dates, custom RPM caps, inline editing, key rotation, revocation, 14-day analytics, interactive SSE playground, plan subscriptions (`Free`, `Basic`, `Pro`, `Enterprise`), and customer account/session controls.
- **Authentication**: Pass either `Authorization: Bearer vk_live_...` or `x-api-key: vk_live_...`.
- **Gateway Endpoints**:
  - `GET /v1/health` — Gateway & engine readiness (`selfHostedEngine` installed/configured diagnostics)
  - `GET /v1/models` & `GET /v1/models/:modelId` — Model catalog with `installed` / `available` flags and credit rates (`models.read`)
  - `GET /v1/usage` — Wallet credits, 14-day daily usage, model breakdown, and RPM limits (`usage.read`)
  - `POST /v1/chat/completions` — OpenAI-compatible completions (`stream: false` and real SSE `stream: true`) routed through the decoupled VEKTOR Engine (`chat.completions`)
  - `POST /v1/embeddings` — Vector embeddings routed via self-hosted or managed cloud embedding models (`embeddings`)

