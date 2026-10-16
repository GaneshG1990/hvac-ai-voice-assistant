# HVAC AI Voice Assistant

[![Tests](https://github.com/GaneshG1990/hvac-ai-voice-assistant/actions/workflows/test.yml/badge.svg)](https://github.com/GaneshG1990/hvac-ai-voice-assistant/actions/workflows/test.yml)

A voice-first assistant that takes HVAC service requests, qualifies them with an LLM, and decides the next step on its own: send a quote, ask the customer for photos over Telegram, or hand the case to a human contractor.

## Features

- **Voice conversation in the browser:** customers press "Call Now" and talk. Speech recognition and spoken replies use the browser's Web Speech API, so no separate speech service is needed.
- **LLM qualification:** the transcript is summarized and classified into one of three outcomes, each with a confidence score:
  - `QUOTE_READY`: enough information to generate a preliminary quote
  - `PICTURES`: photos are needed before quoting
  - `HUMAN_REVIEW`: the case needs a contractor
- **Quote generation:** a cost breakdown (labor + parts) rendered as a PDF and sent to the customer.
- **Telegram photo workflow:** the bot asks the customer for photos, collects their address, and links uploads to the case for contractor review.
- **Auto-quote fallback:** if no photos arrive within 15 minutes, a background scheduler generates the quote anyway, so no case stalls.
- **Contractor portal:** a dashboard for reviewing cases, filtering by status, editing and approving quotes, and submitting human reviews.
- **Contractor sign-in:** the portal and every contractor-only API route sit behind a login with signed, HttpOnly session cookies and lockout after repeated failed attempts.

## How it works

```
Customer speaks ──► Web Speech API (speech-to-text) ──► /api/llm/chat (conversation)
                                                              │
                                                              ▼
                                               /api/llm/analyze (qualify)
                                                              │
                  ┌───────────────────────────────┬───────────┴────────────────┐
                  ▼                               ▼                            ▼
             QUOTE_READY                       PICTURES                   HUMAN_REVIEW
     Generate quote + PDF          Telegram bot requests photos     Shows in contractor portal
                                    └─ no photos in 15 min ─► auto-quote
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Frontend | HTML, CSS, vanilla JavaScript |
| Voice | Web Speech API (`SpeechRecognition`, `speechSynthesis`) |
| LLM | OpenRouter (`microsoft/phi-4-reasoning-plus`) |
| Messaging | Telegram Bot API (`node-telegram-bot-api`) |
| Documents | PDFKit |
| Storage | JSON files (MVP) |
| Auth | HMAC-signed session cookies (Node `crypto`, no extra dependencies) |
| Tests | Node's built-in test runner (`node:test`) |

## Getting started

### Prerequisites

- Node.js 18+
- An [OpenRouter](https://openrouter.ai) API key
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Chrome or Edge, for the best Web Speech API support

### Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your own values:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
PORT=3000

CONTRACTOR_USERNAME=contractor
CONTRACTOR_PASSWORD=change_me_to_a_long_password
SESSION_SECRET=replace_with_a_long_random_string
```

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | LLM access |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot |
| `CONTRACTOR_USERNAME`, `CONTRACTOR_PASSWORD` | Yes, for the portal | Contractor sign-in. Login stays disabled until both are set. |
| `SESSION_SECRET` | Recommended | Signs session cookies. If unset, a random secret is used and sessions reset on restart. Generate one with `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | No | Session length, default 8 |
| `ALLOWED_ORIGINS` | No | Comma-separated origins allowed to call the API cross-origin. Empty means same-origin only. |
| `PORT` | No | Default 3000 |

Set `NODE_ENV=production` when serving over HTTPS so session cookies are marked `Secure`.

The LLM model is set in `server/services/openrouter.js`.

### Run

```bash
npm start
```

- Customer app: http://localhost:3000
- Contractor portal: http://localhost:3000/contractor (redirects to `/login` until you sign in)

To receive photo requests, customers must first open your bot in Telegram and send `/start`. Telegram bots can't message users who haven't started a conversation.

### Test

```bash
npm test
```

The suite covers session tokens, login and lockout, access control on every case route, the customer flow staying public, the contractor quote and review workflow, the 15-minute auto-quote scheduler, and PDF generation. It runs offline: the LLM is stubbed and the Telegram bot is never started. Scripts in `scripts/` are manual checks against a real bot.

## Security model

| Who | Can |
|---|---|
| Customer (no login) | Create a case, save its analysis, save the first generated quote, request photos and confirmations |
| Contractor (signed in) | List, view and delete cases, attach images, submit reviews, edit, approve or request changes on quotes |

Customers cannot set a case's id or quotes directly, cannot approve a quote, and cannot overwrite a quote once one exists. Cross-origin API access is off by default.

## API

Access: **Public** is used by the customer app; **Contractor** needs a signed-in session.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Sign in as a contractor |
| `POST` | `/api/auth/logout` | Public | Sign out |
| `GET` | `/api/auth/me` | Contractor | Current session |
| `POST` | `/api/llm/chat` | Public | Next turn of the voice conversation |
| `POST` | `/api/llm/analyze` | Public | Summarize and qualify a transcript |
| `POST` | `/api/llm/quotation` | Public | Generate a quotation |
| `POST` | `/api/llm/analyze-image` | Public | Analyze a customer photo |
| `POST` | `/api/cases` | Public | Create a case |
| `PATCH` | `/api/cases/:id` | Public* | Update a case (*approval statuses need a contractor) |
| `PATCH` | `/api/cases/:id/quote` | Public* | Save a quote (*only the first one; editing or approving needs a contractor) |
| `GET` | `/api/cases` | Contractor | List cases |
| `GET` | `/api/cases/:id` | Contractor | Get a case |
| `POST` | `/api/cases/:id/images` | Contractor | Attach images to a case |
| `POST` | `/api/cases/:id/human-review` | Contractor | Submit a contractor review |
| `DELETE` | `/api/cases/:id` | Contractor | Delete a case |
| `POST` | `/api/telegram/request-pictures` | Public | Ask the customer for photos |
| `POST` | `/api/telegram/send-confirmation` | Public | Send a confirmation message |
| `GET` | `/api/health` | Public | Health check |

## Project structure

```
├── server/
│   ├── index.js                       # Express app, Telegram endpoints
│   ├── middleware/
│   │   └── auth.js                    # Session tokens and route guards
│   ├── routes/
│   │   ├── auth.js                    # Login, logout, session
│   │   ├── cases.js                   # Case management
│   │   └── llm.js                     # Conversation, analysis, quotes
│   ├── services/
│   │   ├── openrouter.js              # LLM client and prompts
│   │   ├── telegram.js                # Telegram bot
│   │   ├── pdfGenerator.js            # Quote PDFs
│   │   └── autoQuotationScheduler.js  # 15-minute auto-quote fallback
│   └── data/                          # JSON storage (gitignored)
├── public/
│   ├── index.html, js/client.js       # Customer voice app
│   ├── login.html                     # Contractor sign-in
│   └── contractor.html, js/contractor.js  # Contractor portal
├── test/                              # Automated tests (npm test)
└── scripts/                           # Manual checks against a live Telegram bot
```

## Limitations

This is an MVP. Known gaps:

- Data is stored in JSON files, not a database, so it suits a single server instance.
- Contractor sign-in is a single shared account set through environment variables, not per-user accounts.
- Public customer endpoints (LLM and Telegram) have no rate limiting yet.
- Photo analysis is stubbed: photos are stored for contractor review rather than analyzed by a vision model.
- Voice depends on browser support for the Web Speech API (best in Chrome and Edge), and replies are turn-based rather than streamed.
- Pricing data is hardcoded in the LLM prompts.

## Next steps

- Real-time streaming voice (e.g. OpenAI Realtime API over WebRTC) with interruption support
- PostgreSQL for cases and customer history
- Per-contractor accounts with roles
- Rate limiting on public endpoints
- Vision-model photo analysis
- SMS and email notifications

## Built with

Developed with AI-assisted tooling (Claude and Google Antigravity), with the architecture, review and testing done by hand.

## License

MIT
