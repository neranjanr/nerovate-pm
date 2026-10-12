# U3 — Stage-grouped Profiles + add/delete remap

Schema: `status_stages(profile_id, name, order, color_base)`, `statuses.stage_id nullable + shade`; existing rows → Stage `Main`. API: stages CRUD, statuses with `stage_id`, `DELETE /statuses/{id}?replacement_id=` (409 with usage counts if used). Reference: Category → Profile live (no copy). Seed Procurements 5+6+4 example. UI: Stage manager in Category settings, grouped Status select.
Acceptance: add visible immediately with history untouched; delete used without replacement 409, with replacement remaps + writes history.
Blocked-by: U1. Blocks: U4, U5.
