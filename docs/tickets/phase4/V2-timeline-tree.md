# V2 — Timeline indent tree + expand/collapse + Gantt sync

WbsTree in Timeline WBS left pane: indent 0/1/2 + WBS `N / N.M / N.M.K` from `position` order; per-Task/Subtask chevrons; toolbar Collapse all / Expand all + default selector; collapsed row `+N children, M Complete`; manual expand ephemeral per session. Gantt right pane hides with left; collapsed parent shows summary bar `min(start)->max(due)`. New `+Add Subtask/Microtask` auto-expands ancestor chain + highlights new WBS, no default change.
Acceptance: 3-level fixture indents + numbers; chevrons toggle; Collapse/Expand all works; default selector switches row sets; Gantt bars hide in sync; new child reveals + highlights.
Blocked-by: V1. Blocks: V3, V4.
