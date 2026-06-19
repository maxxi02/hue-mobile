# Architecture — BYO Key, No Backend

**Decision:** No Supabase, no server, no auth, no accounts. Hue Mobile mirrors the
desktop app's bring-your-own-key model exactly.

## How it works
- The user enters their own API keys (Anthropic, optionally Deepgram/AssemblyAI/Groq/
  Google/Mistral/Cohere) in Settings.
- Keys are stored in **expo-secure-store** (Android Keystore) — never hardcoded in the bundle.
- The app calls providers **directly** with the user's key (Anthropic SSE stream + prompt
  caching; cloud ASR over WebSocket).
- The OS keystore *is* the secrets manager, satisfying the "never hardcode secrets" rule.

## Why no backend
A backend only exists to hide keys that belong to **you (the developer)**. If the keys
belong to the user, there's nothing to hide.

| Distribution model | Backend + auth? |
|---|---|
| Personal / BYO-key (like desktop) | **No** — keys in secure-store, direct calls |
| Published product where *you* pay for inference | **Yes** — hide your keys server-side + auth + usage limits |

We're in the first row. Revisit only if Hue Mobile becomes a paid hosted product.

## Consequences
- Fully offline-capable shell; no login screens; faster to ship.
- Resume PDF/DOCX parsing happens on-device (not in an edge function).
- See [[Tech Stack]] and [[Phased Roadmap]].
