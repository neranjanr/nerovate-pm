# Spec: Status glyph + weight (scales to 10–15 Statuses per Stage)

**Status:** ready-for-agent

## Problem Statement

A Status Stage can hold 10–15 leaf Statuses, and today they are told apart only by the auto-cascaded shade (light tint → solid, cycling every 4) plus free-text names. In Board, List, Timeline, and Dashboard views with many Statuses, users cannot tell at a glance how far along a Status is within its Stage, nor whether it is a normal step or an exception (On Hold, Blocked, Attention Required, Cancelled, Done). An earlier sketch proposed a fixed 12-name taxonomy with doubled glyphs and hard percentages (e.g. 45% Blocked, 100% On Hold), but that contradicts user-defined Status names and mixes linear progress with exception states on one axis.

## Solution

Keep user-defined Status names and the existing shade cascade untouched, and add two complementary, derived signals per Status: a single text glyph (how far / what kind) and a display-only percent (approximate completeness within its own Stage). Normal Statuses walk a 5-step ramp by position that cycles exactly like shade does, so any count from 2 to 15+ renders sensibly. Exception kinds override the glyph without moving the percent (a 70% Status that becomes Blocked stays 70% with a Blocked flag). Chips appear alongside existing stats in the views users already read: Settings editor, Board/List pills, Timeline group headers, Dashboard tooltip.

## User Stories

1. As a manager, I want each Status to show a glyph plus percent next to its name in Global Settings, so that I can verify stage progression at a glance while renaming or reordering.
2. As a manager, I want the percent to reflect position within its own Stage (first = 0%, last = 100%), so that reordering Statuses automatically updates completeness without manual edits.
3. As a team member, I want Board cards and List rows to show a single compact glyph plus percent on the Status pill, so that I can scan a crowded board with 10–15 Statuses per Stage.
4. As a team member, I want Timeline Stage group headers to show the average percent of their tasks, so that I can compare Stage completeness across Projects.
5. As a manager, I want exception Statuses (On Hold, Blocked, Attention Required, Cancelled) to keep their position percent but render a distinct flag glyph, so that a nearly-complete Blocked task is never confused with an early normal task.
6. As a team member, I want Done Statuses to always render the Done glyph regardless of position, so that completion is unambiguous even in short Stages.
7. As a manager, I want Milestone Statuses to keep their star as a second badge alongside the glyph, so that checkpoint meaning is not replaced by progress meaning.
8. As an admin, I want to set only the exception kind per Status (normal by default) rather than picking glyphs and percents per Status, so that 15-Status Stages need no per-row visual maintenance.
9. As a system, I want weight and normal glyphs derived from ordering (not stored), so that drag-reorder and recascade can never leave stale visuals.
10. As a screen-reader user, I want each glyph exposed with its kind label (not doubled characters or color alone), so that progress and exceptions are perceivable without color.
11. As an on-prem user on any OS, I want glyphs from the monochrome text plane only (no emoji, no webfonts), so that rendering is consistent offline.
12. As a manager viewing the Dashboard, I want done-by-status counts to keep working unchanged with average weight available on hover, so that existing stats are not disrupted.

## Implementation Decisions

- Vocabulary follows the project glossary: leaf is Status, group is Status Stage, set is Status Profile. New glossary terms on build: Status Weight (derived percent within Stage), Status Kind (normal / on_hold / blocked / attention / cancelled overlay), Status Glyph (single text signal, derived ramp plus kind override).
- Three encodings stay orthogonal: shade (existing auto-cascade, which Stage, unchanged including the cycle-every-4 rule past 4) + glyph (how far / what kind) + percent (display-only completeness). Glyph plus percent complement shade; no per-Status shade override.
- Percent rule: for a Stage with n ordered Statuses, the Status at zero-based index i shows round(i / (n-1) * 100); n == 1 shows 100%. Percent is within-Stage, so every Stage runs 0→100 independently. From prototype discussion: a 15-Status Stage steps 0, 7, 14, …, 100.
- Normal glyph ramp (derived, cycles like shade for 6th+): position fraction maps onto five text glyphs in order: ring, upper-right-quarter circle, left-half-black circle, three-quarters-black circle, black circle (i.e. ○ → ◔ → ◑ → ◕ → ●). Exact bucket boundaries are an implementation detail as long as the ramp is monotonic and cycling.
- Kind override (stored, single nullable column with a check constraint, default normal): on_hold renders ‖, blocked renders ! (keeps existing red row/border treatment), attention renders !! (amber), cancelled renders × (dimmed). Done (existing is_done flag) always renders ✓ regardless of position. Milestone keeps ★ as an additional badge, never as a replacement.
- Legacy mapping on migration: existing is_blocked true backfills kind blocked; everything else stays normal. No weight or icon columns are stored.
- Rendering contract: Settings editor shows a read-only chip with glyph plus percent next to the existing Auto shade chip; Board and List Status pills show glyph plus percent; Timeline Stage headers show Stage average percent with task count; Dashboard keeps counts and adds average weight in tooltip only.
- Single shared derivation seam: one pure function of (index, sibling count, kind, is_done) producing (glyph, percent), mirrored on both sides of the stack, consumed by every view. No per-view math duplicates.
- Out-of-scope guards: no fixed global Status taxonomy (names stay user-defined per Profile); no doubled glyphs; no emoji codepoints; no global Save bar changes from the Settings tab work.

## Testing Decisions

- Test external behavior only (rendered glyph/percent/kind transitions and rollup averages), not implementation details (exact tint math internals beyond the percent rule above).
- Highest-seam tests first: pure derivation unit tests (first/middle/last of 2-, 5-, 12-, and 15-Status Stages; single-Status Stage; kind overrides preserving percent; done forcing ✓; milestone star additive). These are new but mirror the existing cascade-shade test style.
- Storage tests: migration adds the kind column with default normal; backfill maps legacy blocked correctly; check constraint rejects unknown kinds; reorder preserves kinds while percents/glyphs update.
- View tests at existing seams: Settings chip shows glyph plus percent beside Auto chip; Board/List pill contract; Timeline average header; Dashboard tooltip average. Prior art: existing status-profile tests for CRUD/order/cascade, board/list rendering tests, dashboard done-by-status tests.
- Accessibility test: each glyph exposes its kind label to assistive tech; color is never the sole signal (glyph plus percent plus existing text).

## Out of Scope

- Enforcing any fixed Status name list; user-defined names per Profile stay.
- Per-Status editable weights or free glyph pickers; per-Status shade overrides.
- Global Settings Save-bar, audit-log, or User Administration tab work.
- Server Health, Backup API, SSO, 2FA, or session-device work.
- Changing the shade cascade algorithm (tints, cycle rule) or the is_done/is_blocked task-blocking computation.
- Per-Task manual progress editing; percent is per-Status and derived.

## Further Notes

- Seams proposed (single ideal): (1) one shared pure derivation function used by all views on both sides; (2) one nullable kind column plus check constraint; (3) existing chips/pills/headers as render points, no new pages. Flag if any view cannot consume the shared seam.
- Why derivation over storage: stored weights rot on every drag-reorder; derived values cannot drift and need no edit UI for the 10–15 common case.
- Why within-Stage over within-Profile: matches the agreed reading of completeness, keeps math local to reorder events, and matches Timeline's Stage grouping. Revisit only if cross-Stage monotonic progress becomes a requirement.
