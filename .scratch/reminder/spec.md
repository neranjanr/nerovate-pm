# Spec: Reminder anchored to work items

**Status:** ready-for-agent

## Problem Statement

Users need dated nudges tied to completed work, e.g. `Buy server` is Complete but must be reinitiated as a replacement in 5 years. No Reminder concept exists today.

## Solution

A Reminder is a dated nudge anchored to exactly one Project, Task, Subtask, or Microtask in any Status (including Complete/Cancelled). One-time or recurring (`none|daily|weekly|monthly|yearly`, end `never|after N|until date`, snooze 1d/1w). Surfaces in My Reminders + anchor badge + due/overdue banner; notifies Assignee + Watchers + Owners. Firing offers one-click "Create follow-up Project" pre-linked `continues-as` plus Done/Dismiss. Date-only defaults to 09:00 server-local; next occurrence derives from due date (no drift). Anchor deleted → Reminder detaches to standalone keeping `ex-anchor title` (never cascades, never blocks delete). Permissions follow the Task edit gate. Standalone calendar reminders (no anchor) are a deferred Phase 2.

## Out of Scope

- Standalone (unanchored) calendar reminders.
- Auto-creation of follow-up Projects or Tasks without user confirmation.
