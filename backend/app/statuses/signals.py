"""Status Weight / Glyph / Kind derivation seam (status-glyph-weight spec).

Single shared pure function of (index, sibling count, kind, is_done)
producing (glyph, percent), mirrored in ``frontend/src/utils/statusSignals.ts``
and consumed by every view. Derived from ordering, never stored, so
drag-reorder and recascade can never leave stale visuals.

Percent rule: for a Stage with n ordered Statuses, the Status at zero-based
index i shows round(i / (n-1) * 100); n == 1 shows 100%.

Normal glyph ramp: position fraction maps onto five monochrome text glyphs
(ring, upper-right-quarter, left-half, three-quarters, full). Kind overrides
and Done keep the position percent and only swap the glyph.
"""

NORMAL = "normal"
ON_HOLD = "on_hold"
BLOCKED = "blocked"
ATTENTION = "attention"
CANCELLED = "cancelled"
DONE = "done"

STATUS_KINDS: tuple[str, ...] = (NORMAL, ON_HOLD, BLOCKED, ATTENTION, CANCELLED)

NORMAL_RAMP: tuple[str, ...] = ("○", "◔", "◑", "◕", "●")

KIND_GLYPHS: dict[str, str] = {
    ON_HOLD: "‖",
    BLOCKED: "!",
    ATTENTION: "!!",
    CANCELLED: "×",
}

DONE_GLYPH = "✓"
MILESTONE_BADGE = "★"

KIND_LABELS: dict[str, str] = {
    NORMAL: "progress",
    ON_HOLD: "on hold",
    BLOCKED: "blocked",
    ATTENTION: "attention required",
    CANCELLED: "cancelled",
    DONE: "done",
}


def normalize_kind(value: str | None) -> str:
    """Validate a stored Status Kind; default None to normal."""
    kind = NORMAL if value is None else str(value).strip().lower()
    if kind not in STATUS_KINDS:
        raise ValueError(f"Unknown status kind: {value!r}")
    return kind


def status_weight(index: int, total: int) -> int:
    """Display-only percent of position i within its own Stage."""
    if total <= 1:
        return 100
    idx = max(0, min(index, total - 1))
    return round(idx / (total - 1) * 100)


def status_glyph(index: int, total: int, kind: str = NORMAL, is_done: bool = False) -> str:
    """Single text glyph: Done wins, then kind override, then position ramp."""
    if is_done:
        return DONE_GLYPH
    kind = normalize_kind(kind)
    if kind != NORMAL:
        return KIND_GLYPHS[kind]
    if total <= 1:
        return NORMAL_RAMP[-1]
    idx = max(0, min(index, total - 1))
    fraction = idx / (total - 1)
    bucket = min(len(NORMAL_RAMP) - 1, int(fraction * len(NORMAL_RAMP)))
    return NORMAL_RAMP[bucket]


def derive_status_signal(
    index: int, total: int, kind: str = NORMAL, is_done: bool = False
) -> tuple[str, int]:
    """Shared seam: (glyph, percent) from ordering + flags."""
    return status_glyph(index, total, kind=kind, is_done=is_done), status_weight(index, total)


def kind_label(kind: str = NORMAL, is_done: bool = False) -> str:
    """Assistive-tech label for a glyph; color is never the sole signal."""
    if is_done:
        return KIND_LABELS[DONE]
    return KIND_LABELS[normalize_kind(kind)]


def empty_stage_signal() -> tuple[str, int]:
    """Shared seam for ADR-0010: a directly-assigned empty Stage renders as a
    single node at 100% with the full glyph.

    Equivalent to derive_status_signal(0, 1) spelled explicitly so callers
    never hardcode the glyph/percent pair.
    """
    return NORMAL_RAMP[-1], 100


def stage_average(weights: list[int]) -> int:
    """Mean positional weight across a Stage's tasks, rounded; 0 when empty."""
    if not weights:
        return 0
    return round(sum(weights) / len(weights))
