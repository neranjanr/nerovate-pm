# U1 — Categories + hybrid membership (blocks all Phase-2)

Schema: `categories(key unique immutable, name globally unique mutable, color, status_profile_id nullable, created_by)`, `category_members`. API: `CRUD /categories`, `CRUD /categories/{id}/members`, `GET /categories/{id}/projects`. UI P0 `/categories` + `[+Add Category]` + members tab. Access: union (category ∪ project), role=max, 404 non-member.
Acceptance: create/rename keeps key; guest sees member Categories only.
Blocked-by: none (first). Blocks: U2, U3, U7.
