# 04: Timeline averages plus Dashboard tooltip

**What to build:** As a team member reviewing Timeline and Dashboard stats, I can see Stage average percent alongside existing counts, so that Stage completeness is comparable without disrupting current statistics.

**Blocked by:** 01 (kind storage plus derivation core).

**Status:** done

- [x] Timeline Stage group headers show average percent with task count, computed from per-Status positional weights
- [x] Dashboard done-by-status counts render unchanged with average weight available on hover
- [x] Exception tasks keep their positional percent in averages with flag glyphs visible, never silently dropped
- [x] Existing timeline done and blocked rollup tests plus dashboard count tests stay green
