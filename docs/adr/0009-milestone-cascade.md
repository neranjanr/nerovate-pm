# Milestone flag plus Tier-1 color cascade

Milestone is a boolean on leaf Status (`is_milestone`), not a separate entity, combinable with `is_done`; Tier-2 display colors are derived read-only shades of the parent Tier-1 `color_base` (light tint → solid), recomputed on stage recolor, create, and reorder.
