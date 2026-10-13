# 02: Reminder recurrence plus overdue plus snooze

**What to build:** As a team member I can make a Reminder repeat on a schedule with a clear end, see it turn overdue when due, and snooze it without losing the cadence.

**Blocked by:** 01 (Reminder anchored core).

**Status:** implemented

- [x] Repeat supports `none|daily|weekly|monthly|yearly` with end `never|after N|until date`
- [x] Overdue Reminders show a red badge plus banner until Done or Dismissed; snooze offers 1d and 1w
- [x] Next occurrence derives from the due date (not the completion date) so yearly cadence never drifts; date-only defaults to 09:00 server-local
- [x] Recurrence, overdue, and snooze transitions are covered by tests at the existing history/notification seams

## Comments

- Implemented end to end: backend `repeat/repeat_end/repeat_after_n/repeat_until/occurrence_index/snoozed_until` columns + additive migration, chaining from due date on Done/Dismiss, server-side `is_overdue`, `POST /snooze`, date-only → 09:00 default (`test_reminder_recurrence.py`, 6 tests). Frontend: repeat/ends inputs, overdue banner + red badges, +1d/+1w snooze, `utils/reminders.ts` + 4 vitest cases. Full suites backend 129/129, frontend 73/73.
