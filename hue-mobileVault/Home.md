# Hue Mobile — Vault Home

Human-readable record for **Hue Mobile**, the Android-first mobile companion of the
[hue-desktop](../../hue-desktop) Electron app (a real-time AI interview assistant).

This vault holds the decisions, setup steps, and roadmap we agreed on so the context
lives in the repo, not only in chat. Update these notes as decisions evolve.

## Decisions
- [[Tech Stack]] — what we're building with and why
- [[Architecture - BYO Key No Backend]] — no server, no auth, keys on-device
- [[Platform - Android First]] — Android vs iOS capability asymmetry
- [[Design System - Calm Focus]] — the shared theme + motion system (2026-06-18 redesign)

## Reference
- [[Feature Map (Desktop to Mobile)]] — every desktop capability → its mobile equivalent
- [[Setup Guide (pnpm)]] — commands to stand the project up
- [[Build Prompt]] — paste-ready prompt to drive the build in a fresh session
- [[Metro unpdf Resolution Fix]] — why on-device resume PDF wouldn't bundle, and the alias that fixes it
- [[First-Launch Warmup]] — pre-warm Groq connection + native recorder so the first turn isn't slow

## Planning
- [[Phased Roadmap]] — the 5 delivery phases
- [[Phase 1 Build Notes]] — what shipped, deviations, and the dev-build runtime change
- [[Open Questions]] — unresolved items

---
*Project root: `C:\dev-proj\hue-extension-claude\hue-mobile`*
*Desktop source of truth: `..\..\hue-desktop\src`*
