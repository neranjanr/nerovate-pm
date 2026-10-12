# 01: Auth plus membership plus view-gate seam

**What to build:** As a signed-in user I see only my Projects and only the views my role allows, so that guests cannot reach restricted views or other Projects' data.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Username/password login issues short access plus refresh tokens; admin creates users with roles admin, manager, member, guest
- [ ] Project membership gates every project-scoped read/write; non-member access behaves as not found
- [ ] Tab bar Board, List, Calendar, Table, Execution Timeline, Dashboard, Workload, Settings is role-gated per the SPEC matrix backend and frontend; guest is read plus comment only
