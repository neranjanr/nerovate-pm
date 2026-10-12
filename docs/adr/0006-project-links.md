# Plain cross-Category Project links, no rollup

`project_links(from, to, kind=relates-to|continues-as)` allows e.g. `Procurements / Buy server continues-as OPEX Items / Buy server`. Link-only: no date rollup, no cross-Project blocked-by, Timeline stays per-Project. Same-pair+kind unique, no self-link.

We rejected cross-Project dependencies for Phase 2 to keep `blocked-map` and Timeline queries per-Project on SQLite.
