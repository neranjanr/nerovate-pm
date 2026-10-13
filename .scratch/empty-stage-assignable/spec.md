# Spec: Empty Stage directly assignable

**Status:** ready-for-agent

## Problem Statement

`CONTEXT.md` and ADR-0005 say a Status Stage is labels-only and never assigned directly, so a Stage with no leaf Statuses cannot be used as a Task's Status.

## Solution

Per ADR-0010: an empty Stage (zero Statuses) is directly assignable at 100% / `●`; a non-empty Stage is never assignable (UI + API reject direct assignment). When the first Status is added under a previously-assigned empty Stage, Tasks on that Stage auto-migrate to the first Status with history written. Board cross-Stage drag onto a non-empty Stage forces a Status picker. The Stage editor offers an optional guided "create matching Status" button, never automatic on assignment. Tier 1 / Tier 2 are deprecated aliases for Stage / Status.

## Out of Scope

- No changes to weight/glyph derivation, shade cascade, or Stage delete/remap rules from ADR-0005.
