# Nerovate-PM

Single on-prem system for 20 users. One context for categories, projects, tasks, and execution timeline.

## Language

**Category**:
A named grouping of Projects with a stable unique ID and display color, e.g. Procurements, OPEX Items. Name is mutable, ID is immutable. No dates, no Status.
_Avoid_: Space, Workspace, Folder

**Project**:
A unit of procurement or recurring work inside a Category with name, code (unique within Category), display color, start date, and Project Status. E.g. Purchase a laptop in Procurements; Buy server in OPEX Items.
_Avoid_: Space, Workspace, Folder

**Project Status**:
The high-level lifecycle state of a Project, fixed as Not Started, Active, Complete, set manually and independent of Task Statuses.
_Avoid_: Category status, Phase, Task Status

**Owner**:
A User who owns a Project; a Project may have few Owners. Edits Project settings.
_Avoid_: Manager, Member, Assignee

**User**:
A login account with immutable username/handle, mutable display name (`name`), role, and active flag. Owner, Assignee, and Watcher are contextual roles of a User.
_Avoid_: Account, Member (role-specific)

**User Profile**:
The self-service view of one's own User: editable display name, read-only username/role, self password change. Admin user CRUD lives in a future separate User Administration tab.
_Avoid_: User management, admin panel

**Backup**:
A nightly SQLite `.backup` plus tar of `/data` (db + uploads). UI is a Draft preview only until the API (list/download/trigger) exists.
_Avoid_: Snapshot (implies live), Export

**Task**:
A top-level work item inside one Project (depth 0), always in exactly one leaf Status. May have Subtasks.
_Avoid_: Ticket, Item

**Subtask**:
A Task child one level deep in the same Project, e.g. 1.1 under Task 1. May have one Microtask level below it.
_Avoid_: Checklist item

**Microtask**:
A Subtask child, two levels below the Task, e.g. 1.1.1. Leaf level, no further children.
_Avoid_: Sub-subtask, nested task

**Status Stage**:
A group label inside a Status Profile, e.g. Prior Approval, Procurement Stage, Post Approval. Never assigned to a Task directly; purely groups leaf Statuses.
_Avoid_: Stage, Phase

**Status**:
A named leaf step inside one Status Stage, defined by users, e.g. Published under Procurement Stage. A Task always sits in exactly one leaf Status.
_Avoid_: State, Phase, Tier 2

**Milestone**:
A leaf Status flagged as a key checkpoint, e.g. Concept Approval Received. Created and edited like a normal Status with a star tag; later paired with a date in table views.
_Avoid_: Phase gate, milestone type

**Status Weight**:
The derived display-only percent of a Status within its own Stage (first 0%, last 100%, single-Status Stage 100%). Never stored; recomputed from ordering, so reordering updates it automatically. No per-Task manual editing.
_Avoid_: Progress (implies Task-level), stored weight

**Status Kind**:
The stored exception overlay of a Status: normal (default), on_hold, blocked, attention, or cancelled. Set per Status; Done stays a separate flag that always wins rendering. Kind never moves the weight.
_Avoid_: Status type, blocked flag (one of several kinds)

**Status Glyph**:
The single derived text signal per Status: a five-step monochrome ramp (○ → ◔ → ◑ → ◕ → ●) by position for normal Statuses, a flag glyph (‖, !, !!, ×) for exception kinds, ✓ for Done, plus an additive ★ badge for Milestones. Always paired with the weight and a text label, never color alone.
_Avoid_: Emoji, icon picker, doubled glyphs

**Status Period**:
The date range for a Task in one Status: start date, due date (planned end), actual end date. All optional; Task-level start defaults to creation date.
_Avoid_: Status dates, phase dates

**Status Profile**:
The ordered set of Status Stages plus their ordered leaf Statuses for a Category. All Projects in the Category inherit it by reference. Different Categories use different Profiles.
_Avoid_: Workflow, Pipeline, Status template

**Project Link**:
A directional relates-to / continues-as reference from one Project to another, allowed across Categories, e.g. Procurements / Buy server continues-as OPEX Items / Buy server. Plain link only, no date rollup or cross-Project blocking.
_Avoid_: Dependency, Clone

**Project Template**:
A reusable Status Profile plus field definitions, e.g. Procurement vs Repetitive monthly process.
_Avoid_: Profile, Blueprint

**Assignee**:
A User responsible for a Task.
_Avoid_: Owner (owner is Project-level), Member

**Watcher**:
A User following a Task without assignment.
_Avoid_: Follower, Subscriber
