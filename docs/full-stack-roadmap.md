# RB Revision Full-Stack Roadmap

## Current app

Today the app is a static PWA:

- question banks are JSON files in `/data`
- progress, goals, and filters live in browser storage
- the Anthropic key is stored in the browser
- AI requests are made directly from the client

That is good for a fast prototype, but not for a durable cross-device product.

## What a full-fledged app needs

1. Accounts and login
2. Cloud-synced progress across phone and laptop
3. Server-side AI proxy so API keys are never stored in the browser
4. Admin/import tools for CAIA, GMAT, Energy, and PE content
5. Real content model for questions, flashcards, modules, readings, and goals
6. Backups, observability, and controlled releases

## Recommended architecture

### Best balance for this project

- Frontend: keep the current PWA shell, but deploy it on Cloudflare Pages
- Auth + database + storage: Supabase
- Backend API: small Node service or serverless functions
- AI provider proxy: backend endpoint that calls Anthropic and optionally OpenAI
- File uploads: Supabase Storage
- Background jobs: cron on the backend, or Supabase scheduled jobs / external worker later

This gives you:

- simple deployment
- proper HTTPS for iPhone install
- synced data
- less maintenance than a raw VPS
- room to add a chat tutor, reading sync, and imports

## When to use a VPS

Use a VPS if you want:

- one box you fully control
- Docker-based hosting
- custom OCR / PDF pipelines
- background workers and private services without serverless limits
- lower platform abstraction

Do **not** start with a VPS if the main goal is simply "make the app work well on my phone and sync progress". Managed services get you there faster.

## Recommended path

### Phase 1: Production-ready hosted app

- Deploy the current frontend to Cloudflare Pages
- Move progress/settings/goals into Supabase tables
- Add email login or magic-link auth
- Move AI calls behind `/api/ai/*`
- Store user API preferences server-side

### Phase 2: Real study system

- Daily and weekly goals with streak history
- Calendar history synced per user
- Question tagging by official curriculum module
- Import pipeline for flashcards and question banks
- AI question chat with saved conversation history
- Reading tracker for CAIA chapters and assigned revision

### Phase 3: Admin and analytics

- Admin content upload dashboard
- Per-module performance analytics
- Weak-area clustering
- Review queues
- Study recommendations
- Push or email reminders

## Concrete product features to build next

### Student-facing

- auth
- synced progress
- synced daily goals
- synced AI chat history
- saved flagged questions
- saved flashcard review history
- reading tracker tied to CAIA curriculum modules
- import/export backup

### Admin-facing

- upload CSV/PDF content
- tag questions to curriculum modules
- publish question-bank revisions
- deactivate bad questions
- inspect AI usage

## Suggested deployment options

### Option A: Recommended

- Cloudflare Pages for the frontend
- Supabase for auth, Postgres, storage, and row-level security
- lightweight backend functions for AI proxy and imports

Best for:

- lowest maintenance
- fast phone rollout
- secure API handling
- easy sync

### Option B: VPS-centric

- DigitalOcean Droplet
- Docker Compose
- Postgres
- Caddy or Nginx
- Node API
- object storage separately if needed

Best for:

- full control
- custom pipelines
- long-running workers

Tradeoff:

- you manage updates, security patches, backups, SSL, uptime, and database operations

## MVP backend scope

If we upgrade this app now, the first backend should include:

- `POST /auth/*`
- `GET /me`
- `GET /questions/:module`
- `GET /flashcards/:module`
- `POST /progress/attempt`
- `POST /progress/flashcard-review`
- `POST /goals`
- `GET /calendar/:module`
- `POST /ai/chat`
- `POST /imports/caia`

## Cost-minded recommendation

Start managed first.

If you want a practical first production setup, I would build:

- Cloudflare Pages
- Supabase Pro only when you outgrow free
- a tiny backend for AI proxying

Then move specific heavy jobs to a VPS only if you actually need them.

## My recommendation

For your use case, I would **not** start with a raw VPS as the main architecture.

I would build:

1. hosted PWA
2. Supabase-backed sync
3. server-side AI chat
4. admin import tools

Then add a VPS later only for heavyweight import and automation workflows.
