# 01: Kind storage plus derivation core

**What to build:** As a manager I can mark any Status with an exception kind through the API with sensible defaults, so that downstream views can distinguish normal progress steps from On Hold, Blocked, Attention, and Cancelled without manual visual upkeep.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Status Kind persists per Status with default normal plus a constraint rejecting unknown kinds; legacy blocked statuses backfill to blocked kind
- [x] Percent derives from position within its own Stage (first 0%, last 100%, single-Status Stage 100%) for Stage sizes 2 through 15
- [x] Normal glyph derives from position on a monotonic five-step ramp that cycles for 6th-plus Statuses; Done always renders its glyph regardless of position; kind overrides preserve percent
- [x] Every status payload consumed by views carries kind alongside existing done and milestone flags
- [x] Derivation unit tests plus migration and backfill tests pass; existing status-profile ordering and cascade tests stay green
