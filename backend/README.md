# Autotrade Backend

## Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt

# Configure credentials
copy env.example .env
# Then edit .env with your broker API keys

# Run the server
uvicorn app.main:app --reload --port 8000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/broker/status` | Check broker connection status |
| POST | `/api/broker/connect` | Connect to Alice Blue or Zerodha |
| GET | `/api/broker/zerodha/login-url` | Get Zerodha OAuth login URL |
| GET | `/api/broker/ltp` | Sanity-check LTP for a symbol via connected broker |
| POST | `/api/strikes` | Fetch OTM1/ATM/ITM1 strikes |
| POST | `/api/bot/configure` | Configure a grid row bot |
| POST | `/api/bot/{id}/start` | Start a bot row |
| POST | `/api/bot/{id}/stop` | Stop a bot row |
| POST | `/api/bot/stop-all` | Stop all bots |
| POST | `/api/bot/kill-all` | Kill all + flatten positions |
| GET | `/api/bot/state` | Get all bot states |
| GET | `/api/trades/today` | Get today's trade history |
| WS | `/ws` | WebSocket live state push |

## Project Structure

```
backend/
├── app/
│   ├── main.py           # FastAPI app, WebSocket, all routes
│   ├── config.py         # Settings from .env
│   ├── database.py       # Async SQLAlchemy setup
│   ├── models.py         # TradeLog, BotState ORM models
│   ├── brokers/
│   │   ├── aliceblue.py  # Alice Blue adapter (pya3)
│   │   └── zerodha.py    # Zerodha KiteConnect adapter
│   └── services/
│       ├── option_chain.py  # OTM1/ATM/ITM1 strike resolver
│       ├── bot_engine.py    # Per-row async bot loop
│       └── notifier.py      # Telegram alerts
├── requirements.txt
└── env.example
```
