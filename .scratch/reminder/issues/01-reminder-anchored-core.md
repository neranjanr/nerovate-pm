# 01: Reminder anchored core (one-time)

**What to build:** As a team member I can create a one-time dated Reminder on a completed Project or Task (e.g. `Buy server` Complete → "reinitiate replacement in 5 years") and see it in context until I act on it.

**Blocked by:** None (can start immediately).

**Status:** implemented

- [x] Reminder anchors to exactly one Project, Task, Subtask, or Microtask in any Status including Complete and Cancelled
- [x] My Reminders list plus anchor badge show the Reminder; Done and Dismiss both resolve it
- [x] Creation and editing follow the Task edit gate; visible to Assignee, Watchers, and Project Owners
- [x] Reminder CRUD plus anchor-permission tests pass; existing Task, Status, and Project Link tests stay green

## Comments

- Implemented end to end: backend CRUD + gates (`app/reminders/`, `test_reminder_core.py`) plus frontend My Reminders page (`pages/Reminders.tsx`), TaskDrawer anchor badge (`TaskReminderBadge`), Done/Dismiss actions, `/reminders` route + Sidebar link. Full suites backend 129/129, frontend 73/73, `tsc` clean.
