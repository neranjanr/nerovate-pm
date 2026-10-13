# 03: Reminder follow-up plus detach on delete

**What to build:** As a team member acting on a fired Reminder I can spin up the follow-up work already linked to the original, and deleting anchored work never destroys a future nudge.

**Blocked by:** 01 (Reminder anchored core).

**Status:** implemented

- [x] Firing notifies Assignee, Watchers, and Project Owners and offers one-click "Create follow-up Project" pre-linked via Project Link `continues-as`; nothing auto-creates without confirmation
- [x] Reminder stays on the original anchor plus forward link; it never migrates to the follow-up Project
- [x] Deleting the anchored Project, Task, Subtask, or Microtask detaches its Reminders to standalone keeping the `ex-anchor title`; delete is never blocked and Reminders are never cascade-deleted
- [x] Follow-up creation and detach-on-delete are covered by tests; recurring Reminders (02) keep working on detached items

## Comments

- Implemented end to end: backend fire (notify Assignee+Watchers+Owners, no auto-create), follow-up-project with `continues-as` link, detach-to-standalone on all delete paths (`test_reminder_followup_detach.py`). Frontend: Fire panel with notify count + inline follow-up creation linking to the new Project; detached rows show kept ex-anchor title. Full suites backend 129/129, frontend 73/73.
