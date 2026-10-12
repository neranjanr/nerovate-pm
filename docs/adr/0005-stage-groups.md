# Stage groups over leaf Statuses, shaded Board, remap on delete

Stages are labels only (`status_stages`), Tasks sit in leaf Statuses. Board collapses to Stage counts and expands to scrollable leaf columns tinted from the Stage base color (15–20 columns viable). Adding a Status appends to a Stage without touching history; deleting a used Status is blocked with 409 until a same-Profile replacement is chosen, then remapped with `task_history` written and old periods retained.

We rejected flat 15-column Boards (unreadable) and silent delete (would orphan `tasks.status_id`).
