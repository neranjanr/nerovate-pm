# Two-level hierarchy inside Tasks

Task depth is capped at 2 inside a Task: Task (0) > Subtask (1.1) > Microtask (1.1.1, leaf). Same Project only, enforced in API. We rejected unlimited nesting to keep List/Table/Timeline queries viable on SQLite for 20 users, and rejected flat 1-level because procurement breakdowns need 1.1.1 granularity.
