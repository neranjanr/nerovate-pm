# Category on top, Project drops one level, Profile by reference

Category (`key` immutable, name mutable, color, no dates) owns the Status Profile; Projects (`UNIQUE(category_id, code)`, `UNIQUE(category_id, name)`) inherit it by live reference instead of the v0.2 per-Project copy. Membership is hybrid: category grant covers all Projects, project grant covers one; effective = union, role = max.

We rejected keeping Profile per-Project (would force re-apply on every new Status) and rejected Category as UI-only folder (would not solve the 15-status procurement flow shared across procurements).
