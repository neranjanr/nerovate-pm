# 02: Settings editor chip plus kind picker

**What to build:** As a manager editing a Status Profile I can see each Status glyph with percent beside its shade chip and set its exception kind, so that stage progression is verifiable at a glance while renaming or reordering.

**Blocked by:** 01 (kind storage plus derivation core).

**Status:** done

- [x] Each Status row shows a read-only glyph plus percent chip next to the existing auto shade chip, correct for 2- through 15-Status Stages
- [x] Kind picker offers normal plus on-hold, blocked, attention, and cancelled; saving persists and re-renders the chip without page reload
- [x] Reordering and recolor-recascade update glyphs and percents automatically with no stale values
- [x] Done forces its glyph and Milestone star renders additively, never replaced
- [x] Shade cascade behavior and existing profile CRUD tests stay green
