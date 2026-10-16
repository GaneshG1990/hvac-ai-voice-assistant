# HVAC AI Voice Assistant

A voice-first assistant that takes HVAC service requests, qualifies them with an LLM, and decides the next step on its own: send a quote, ask the customer for photos over Telegram, or hand the case to a human contractor.

## Features

- **Voice conversation in the browser:** customers press "Call Now" and talk. Speech recognition and spoken replies use the browser's Web Speech API, so no separate speech service is needed.
- **LLM qualification:** the transcript is summarized and classified into one of three outcomes, each with a confidence score:
  - `QUOTE_READY`: enough information to generate a preliminary quote
  - `PICTURES`: photos are needed before quoting
  - `HUMAN_REVIEW`: the case needs a contractor
- **Quote generation:** a cost breakdown (labor + parts) rendered as a PDF and sent to the customer.
- **Telegram photo workflow:** the bot asks the customer for photos, links uploads to the case, and runs AI image analysis on them.
- **Auto-quote fallback:** if no photos arrive within 15 minutes, a background scheduler generates the quote anyway, so no case stalls.
- **Contractor portal:** a dashboard for reviewing cases, filtering by status, and submitting human reviews.

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

Fill in `.env` with your own keys:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
PORT=3000
```

The LLM model is set in `server/services/openrouter.js`.

### Run

```bash
npm start
```

- Customer app: http://localhost:3000
- Contractor portal: http://localhost:3000/contractor

To receive photo requests, customers must first open your bot in Telegram and send `/start`. Telegram bots can't message users who haven't started a conversation.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/llm/chat` | Next turn of the voice conversation |
| `POST` | `/api/llm/analyze` | Summarize and qualify a transcript |
| `POST` | `/api/llm/quotation` | Generate a quotation |
| `POST` | `/api/llm/analyze-image` | Analyze a customer photo |
| `GET` | `/api/cases` | List cases |
| `GET` | `/api/cases/:id` | Get a case |
| `POST` | `/api/cases` | Create a case |
| `POST` | `/api/cases/:id/images` | Attach images to a case |
| `POST` | `/api/cases/:id/human-review` | Submit a contractor review |
| `DELETE` | `/api/cases/:id` | Delete a case |
| `POST` | `/api/telegram/request-pictures` | Ask the customer for photos |
| `POST` | `/api/telegram/send-confirmation` | Send a confirmation message |
| `GET` | `/api/health` | Health check |

## Project structure

```
├── server/
│   ├── index.js                       # Express app, Telegram endpoints
│   ├── routes/
│   │   ├── cases.js                   # Case management
│   │   └── llm.js                     # Conversation, analysis, quotes
│   ├── services/
│   │   ├── openrouter.js              # LLM client and prompts
│   │   ├── telegram.js                # Telegram bot
│   │   ├── pdfGenerator.js            # Quote PDFs
│   │   └── autoQuotationScheduler.js  # 15-minute auto-quote fallback
│   └── data/                          # JSON storage (gitignored)
└── public/
    ├── index.html, js/client.js       # Customer voice app
    └── contractor.html, js/contractor.js  # Contractor portal
```

## Limitations

This is an MVP. Known gaps:

- Data is stored in JSON files, not a database.
- The contractor portal has no authentication.
- Voice depends on browser support for the Web Speech API (best in Chrome and Edge), and replies are turn-based rather than streamed.
- Pricing data is hardcoded in the LLM prompts.
- There are no automated tests.

## Next steps

- Real-time streaming voice (e.g. OpenAI Realtime API over WebRTC) with interruption support
- PostgreSQL for cases and customer history
- Authentication for the contractor portal
- SMS and email notifications
- Automated tests

## License

MIT
