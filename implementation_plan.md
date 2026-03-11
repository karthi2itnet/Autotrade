# Performance Optimization Analysis: Instant Order Execution

## Current Execution Bottlenecks
The system's goal is to place an order instantly when the underlying price hits the target criteria. Having reviewed the codebase, here are the current mechanisms affecting latency:

1. **Broker Polling Speed (LTP loop)**
   - The backend polls Alice Blue for live options prices in [_ltp_poller_loop](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/main.py#565-580) using `await asyncio.sleep(0.25)`. This means it fetches prices 4 times a second.
   - Delay potential: **Up to 250ms**.

2. **Bot Engine Evaluation Loop**
   - The bot engine runs a continuous `while True` loop per row in [_run_row](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py#166-219). At the end of every evaluation tick, it runs `await asyncio.sleep(0.1)`.
   - Delay potential: **Up to 100ms**.

3. **Broker Order Network Call**
   - When a trade triggers, the [_open_lot](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py#222-249) and [_close_lot](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py#250-287) functions hit the [_place_buy](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py#320-331) and [_place_sell](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py#332-344) functions.
   - Alice Blue API execution is already highly optimized. It bypasses the standard `pya3` synchronous SDK in favor of a persistent `httpx.AsyncClient` that reuses TCP connections (no TLS handshake overhead per order). 
   - Known execution time: Usually `< 100ms` for network transit.

## Recommended Optimizations

To achieve instantaneous execution, we can tighten the background loops since Render environments (even the free tier) are typically high bandwidth and can handle more aggressive internal loops, provided we don't hit the broker's API rate limits.

### 1. Increase Polling Frequency (LTP)
**Current:** `asyncio.sleep(0.25)` (4 polls/sec)
**Proposed:** `asyncio.sleep(0.10)` (10 polls/sec)
**File:** [backend/app/main.py](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/main.py)
This decreases the maximum theoretical delay in seeing a new price from 250ms down to 100ms. Note: Alice Blue might have API rate limits; if 10/sec triggers a 429 Too Many Requests, we may need to dial it back to 0.15s.

### 2. Tighten Bot Engine Loop
**Current:** `asyncio.sleep(0.1)` (10 checks/sec)
**Proposed:** `asyncio.sleep(0.02)` (50 checks/sec)
**File:** [backend/app/services/bot_engine.py](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py)
The bot checking logic is extremely lightweight. Sleeping for only 20ms ensures that the moment a new LTP is registered in the cache, the Bot Engine will process it and trigger an order almost instantly.

### 3. Asynchronous Pre-computation (Future)
Currently, [_place_buy](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/services/bot_engine.py#320-331) requires resolving instrument configuration before calling the broker. The NFO contract caching in `_instrument_cache` already happens correctly, making subsequent orders instant. The first order for any strike may face a penalty. 

## Verification Plan

### Test Code
1. Inspect the backend terminal logs while running the application.
2. The `logger.info` in [_place_order_direct](file:///c:/Users/HP/.gemini/antigravity/scratch/Autotrade/backend/app/brokers/aliceblue.py#148-199) measures connection speed to Alice Blue. Verify this remains under 200ms.

### Manual Verification
1. Start a row in Paper Mode to bypass actual execution limits.
2. Observe the latency on the frontend between the price ticking across the threshold and the Trade Log entry appearing. It should feel instantaneous.
