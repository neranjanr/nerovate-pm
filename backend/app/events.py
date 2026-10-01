"""In-process event bus stub (SPEC-v0.2 section 4.5).

MVP: synchronous pub/sub for task.status_changed / task.comment_added.
Email/SMS deferred. Other modules import publish/subscribe only --
never direct model imports (modularity contract).
"""

_subscribers: dict[str, list] = {}


def subscribe(event: str, fn):  # type: ignore[no-untyped-def]
    _subscribers.setdefault(event, []).append(fn)


def publish(event: str, payload: dict) -> None:
    for fn in _subscribers.get(event, []):
        fn(payload)
