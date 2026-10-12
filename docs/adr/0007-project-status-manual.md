# Manual Project Status, independent of Task Statuses

`projects.project_status` is `Not Started | Active | Complete`, default `Active`, set via `PATCH /projects/{id}`. Label only: free transitions both ways, no task freeze, no rollup from Task Statuses / Status Profile.

We rejected auto-rollup (e.g. Complete when all tasks done) to keep Project lifecycle manually controlled per grill decision 2026-10-07.
