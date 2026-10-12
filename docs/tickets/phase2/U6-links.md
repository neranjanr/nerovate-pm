# U6 — Cross-Category Project links (plain)

Schema: `project_links(from,to,kind=relates-to|continues-as,note)` unique pair+kind, no self-link. API: `POST/GET/DELETE /projects/{id}/links`. UI: header `Linked projects` chips with `Category / Project` jump (e.g. continues-as OPEX tracker). No rollup, no cross blocked-by.
Acceptance: link across Categories created/jumped; self-link 422; Board/Timeline stay per-Project.
Blocked-by: U2. Blocks: none.
