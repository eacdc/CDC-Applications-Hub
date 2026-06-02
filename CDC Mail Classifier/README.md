# CDC Mail Classifier

Self-hosted web app that polls Gmail inboxes, classifies incoming mail with OpenAI, and presents a review dashboard for CDC Printers staff.

Replaces an n8n workflow for sorting prepress, production, and packaging email.

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express, TypeScript |
| Frontend | React, Vite, TypeScript, Tailwind |
| Database | MongoDB (Mongoose) |
| Gmail | Gmail API via `googleapis` (OAuth2 refresh tokens) |
| LLM | OpenAI Chat Completions (two-tier: cheap → strong) |
| Polling | `node-cron` every minute |

## Project layout

```
CDC Mail Classifier/
├── server/          # Express API + cron poller
├── client/          # React dashboard
└── README.md
```

## Prerequisites

- Node.js 20+
- MongoDB Atlas cluster (or local MongoDB)
- Google Cloud project with Gmail API enabled
- OpenAI API key with access to configured models

## Environment variables

Copy `server/.env.example` to `server/.env` and fill in:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Must match Google Cloud console (default `http://localhost:3002/api/auth/google/callback`) |
| `ENCRYPTION_KEY` | 64-char hex (32 bytes) for encrypting Gmail refresh tokens |
| `PORT` | API port (default `3002`) |
| `CLIENT_URL` | Frontend URL for OAuth redirect (default `http://localhost:5175`) |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Model names** are in `server/src/config.ts` (`gpt-5-nano`, `gpt-5.4-mini`). Verify these are enabled on your OpenAI account before running.

## MongoDB Atlas setup

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Create a database user with read/write access.
3. Allow your IP (or `0.0.0.0/0` for dev) in Network Access.
4. Copy the connection string into `MONGODB_URI`, e.g.:
   ```
   mongodb+srv://user:pass@cluster.mongodb.net/cdc-mail-classifier
   ```

Indexes on `messageId` (unique) and review fields are created automatically at startup via `syncIndexes()`.

## Google Cloud OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project → **APIs & Services** → **Enable APIs** → enable **Gmail API**.
3. **Credentials** → **Create credentials** → **OAuth client ID** → type **Web application**.
4. Authorized redirect URI: `http://localhost:3002/api/auth/google/callback` (adjust for production).
5. Copy Client ID and Client Secret into `.env`.
6. If testing with a Workspace account, configure OAuth consent screen and add test users.

Scopes used: `https://www.googleapis.com/auth/gmail.readonly`

## Development

Install dependencies and run both apps:

```bash
# Terminal 1 — API + poller
cd server
npm install
npm run dev

# Terminal 2 — React UI
cd client
npm install
npm run dev
```

- API: http://localhost:3002
- UI: http://localhost:5175 (proxies `/api` to the server)

Production build:

```bash
cd server && npm run build && npm start
cd client && npm run build   # static files in client/dist
```

## Adding an inbox

1. Open **Inboxes** in the UI (http://localhost:5175/inboxes).
2. Enter a **label** (e.g. `prepress`) and **email address**.
3. Click **Add inbox**, then **Connect Gmail** for that row.
4. Complete Google OAuth consent — the refresh token is encrypted and stored in MongoDB.
5. The cron job polls active inboxes every minute (messages from the last 5 minutes).

OAuth start URL (manual):

```
http://localhost:3002/api/auth/google?label=prepress&emailAddress=prepress@yourdomain.com
```

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/emails` | List with filters + pagination |
| GET | `/api/emails/:id` | Single email |
| PATCH | `/api/emails/:id` | Staff correction (`reviewed=true`) |
| POST | `/api/reclassify/:id` | Re-run classifier |
| GET | `/api/stats` | Dashboard aggregates |
| GET/POST | `/api/inboxes` | Manage inboxes |
| GET | `/api/auth/google` | Start OAuth |
| GET | `/api/auth/google/callback` | OAuth callback |

## Classification flow

1. **Poll** — every minute, fetch Gmail messages from the last 5 minutes per inbox.
2. **Dedupe** — upsert on `messageId` (unique index).
3. **Normalize** — decode body, strip HTML/quotes, cap at 8000 chars.
4. **Classify** — `gpt-5-nano` first; escalate to `gpt-5.4-mini` if confidence &lt; 0.6 or parse failure.
5. **Store** — persist metadata + classification; flag `needsReview` when confidence &lt; 0.7.

Prompt text lives in `server/src/prompts/classifier.ts`.

## Security notes

- Never commit `server/.env`.
- Refresh tokens are AES-256-GCM encrypted at rest.
- This tool is intended for internal use; add authentication before exposing publicly.
