# Empty Stage directly assignable, auto-migrate on first Status

Amends ADR-0005 (Stages were labels-only): an empty Stage (zero Statuses) is directly assignable as a Task's Status at 100% / `●`, while a non-empty Stage is never assignable (UI + API reject). When the first Status is added under a previously-empty assigned Stage, Tasks on that Stage auto-migrate to the first Status with history written.

We chose treat-as-leaf over auto-create-same-name and over block-empty-Stage because single-step Stages are legitimate and assignment must stay frictionless; auto-migration keeps the invariant "exactly one assignable node, non-empty Stage never assignable" without split-brain.

**Considered Options**: auto-create same-name Status with Info+OK; block Stage save until >= 1 Status. Rejected: friction / forbids legitimate single-step Stages.
**Consequences**: dropdown shows empty Stages as selectable rows and non-empty Stages as disabled headers; cross-Stage Board drag forces a Status picker; Stage delete/remap rules from ADR-0005 still apply to leaf Statuses.
