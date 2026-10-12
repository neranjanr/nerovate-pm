# Kanban Board UX and Interaction Specification

## 1. Purpose

The Kanban Board shall provide a compact, scalable, and intuitive interface for managing projects containing:

- Tier 1 Statuses
- Tier 2 Statuses
- Tasks
- Subtasks
- Microtasks
- Milestones

The design shall support workflows containing a large number of statuses, including 20+ Tier 1/Tier 2 statuses, without unnecessarily consuming horizontal screen space.

The primary UX principle shall be:

> Keep the normal Kanban layout compact and stable. Reveal additional information temporarily and contextually when the user needs it.

Drag-and-drop operations shall not unnecessarily expand or rearrange the permanent Kanban layout.


---

# 2. Status Hierarchy

The application supports two status levels:

## 2.1 Tier 1 Status

Tier 1 represents the main workflow stage.

Example:

- Not Started
- Planning
- Procurement
- Implementation
- Testing
- Completed


## 2.2 Tier 2 Status

Tier 2 represents detailed states within a Tier 1 Status.

Example:

Planning
- Initial Planning
- Requirement Gathering
- Design
- Management Approval

Testing
- Test Preparation
- Internal Testing
- User Acceptance Testing
- Final Verification


## 2.3 Work Item Hierarchy

The work-item hierarchy shall be:

Project
└── Task
    └── Subtask
        └── Microtask

Additional hierarchy levels below Microtask shall not be created.


---

# 3. Default Kanban Layout

## 3.1 Tier 1 Column Width

A populated Tier 1 Status should use approximately:

1/6 of the available Kanban viewport width

as its preferred/default width.

This is a target width rather than a mandatory fixed width.

The layout engine may slightly adjust widths to achieve a visually balanced board.


## 3.2 Dynamic Width Balancing

Column widths should consider:

- available viewport width;
- number of visible statuses;
- populated vs empty statuses;
- expanded/collapsed state;
- minimum readable width;
- user-selected density mode.

The application should avoid unnecessarily wide empty areas.


## 3.3 Stable Layout

Normal interaction with tasks should not cause unrelated columns to move unexpectedly.

In particular:

> Drag operations shall not change the persistent geometry of the Kanban Board.

Temporary information needed during dragging shall be presented using overlays rather than permanent column expansion.


---

# 4. Empty Status Optimization

Statuses containing no Tasks, Subtasks, or Microtasks shall not consume normal column width.


## 4.1 Empty Tier 1 Status

An empty Tier 1 Status shall collapse into a thin vertical rail.

Example:

| PLANNING |

The status name may be rotated 90 degrees to save horizontal space.

The rail shall remain clearly identifiable and selectable.


## 4.2 Empty Rail Width

The width shall be only enough to:

- identify the status;
- display status color;
- provide drag/drop targeting;
- provide interaction affordances.


## 4.3 Hover Behaviour

Hovering over an empty rail may temporarily reveal:

- full status name;
- task count;
- Add Task action.

The actual column shall remain compact unless explicitly expanded by the user.


## 4.4 Empty Tier 2 Status

Empty Tier 2 statuses should preferably be displayed as compact chips/tabs instead of large empty areas.

Example:

Planning

[Requirements]
Task A
Task B

○ Design (0)
○ Approval (0)
○ Review (0)


---

# 5. Manual Expand and Collapse

Users may manually expand or collapse Tier 1 and Tier 2 statuses.

Manual expansion/collapse shall be considered persistent user UI state.

For example:

Click status header
→ Expand/Collapse Status

Temporary expansions used for drag-and-drop shall NOT modify this saved state.


---

# 6. Drag and Drop

Tasks, Subtasks, and Microtasks may support drag-and-drop movement where allowed.


## 6.1 Basic Drag Behaviour

When dragging an item:

1. Highlight the currently valid drop targets.
2. Show the original location.
3. Show the potential destination.
4. Do not automatically expand columns immediately.
5. Do not modify permanent board geometry.


---

# 7. Temporary Drop Bucket

When the dragged item is held over a collapsed status that contains Tier 2 statuses, the system shall display a temporary Drop Bucket.

The actual Kanban column shall NOT be expanded.


## 7.1 Hover Delay

The Drop Bucket shall not appear immediately.

A configurable hover delay shall be used.

Recommended default:

500 ms

Purpose:

When a user drags across many statuses, temporary buckets should not continuously appear and disappear.


## 7.2 Pre-Activation Indicator

Before the bucket appears, provide a subtle indication that additional destinations are available.

Example:

PLANNING ▾


## 7.3 Drop Bucket Example

Dragging:

"Prepare Tender Document"

over Planning may display:

┌──────────────────────────┐
│ PLANNING                 │
│ Select destination       │
├──────────────────────────┤
│ ○ Initial Planning       │
│ ○ Requirements           │
│ ○ Design                 │
│ ○ Management Approval    │
└──────────────────────────┘


## 7.4 Bucket Behaviour

The bucket shall:

- appear near the target status;
- remain visible while the pointer is over the status or bucket;
- allow Tier 2 selection;
- visually highlight the current target;
- disappear if the user leaves the target region;
- disappear after drop;
- disappear if dragging is cancelled.

The bucket must not permanently alter the Kanban layout.


---

# 8. Dragging Within the Same Tier 1 Status

Dragging a task while remaining within its existing Tier 1 Status shall allow movement between its Tier 2 statuses.

Example:

Planning > Requirements

to:

Planning > Design


## 8.1 Same-Status Drop Bucket

If the user drags an item and holds it over its current Tier 1 Status, the same Drop Bucket mechanism shall appear.

The user can then select another Tier 2 destination.

This avoids requiring a separate interaction for changing only the Tier 2 Status.


---

# 9. Dropping into a Different Tier 1 Status

When a task is dragged into another Tier 1 Status containing Tier 2 statuses:

1. Hover over destination.
2. Wait for Drop Bucket delay.
3. Display available Tier 2 statuses.
4. User selects intended Tier 2 destination.
5. User drops item.
6. Display confirmation.
7. Save change after confirmation.
8. Close Drop Bucket.
9. Restore previous Kanban layout.


---

# 10. Drop Confirmation

After a drag-and-drop operation, a confirmation dialog shall be available.

Example:

Move Task

Task:
Prepare Technical Specification

From:
Planning > Requirements

To:
Procurement > Tender Preparation

Target Sub-status:
[Tender Preparation ▼]

[Cancel]     [Move Task]


## 10.1 Editable Destination

The destination Tier 1/Tier 2 status shall remain editable in the confirmation dialog.

This gives the user a final opportunity to correct an incorrect drop.


## 10.2 Configurable Confirmation Rules

The application should support configurable confirmation behaviour:

- Always confirm
- Confirm only when Tier 1 changes
- Confirm only for selected statuses
- Never confirm

Example:

Moving:

Planning > Requirements
→ Planning > Design

may not require confirmation.

Moving:

Implementation
→ Completed

may require confirmation.


---

# 11. Undo Status Change

After a successful move, display a temporary Undo notification.

Example:

Task moved to:

Testing > Internal Testing

[UNDO]

Undo shall restore the previous:

- Tier 1 Status
- Tier 2 Status

where applicable.


---

# 12. Auto Scroll During Drag

If the user drags an item close to the left or right edge of the Kanban viewport, horizontal auto-scroll shall activate.


## 12.1 Progressive Speed

Auto-scroll should increase as the pointer approaches the viewport edge.

Example:

Near edge
→ Slow scroll

At edge
→ Faster scroll


## 12.2 Drop Bucket Priority

When the pointer is interacting with a Drop Bucket, Drop Bucket interaction shall take priority over auto-scroll.

The board must not move unexpectedly while the user is selecting a Tier 2 destination.


---

# 13. Add Task Button

Every applicable status shall provide an Add Task button at the end of its task list.

Example:

┌──────────────────────────┐
│ Task A                   │
├──────────────────────────┤
│ Task B                   │
├──────────────────────────┤
│ Task C                   │
├──────────────────────────┤
│        + Add Task        │
└──────────────────────────┘


## 13.1 Context-Aware Creation

The Add Task button shall inherit its location.

Example:

If Add Task is clicked inside:

Planning > Design

the new task shall automatically receive:

Tier 1 Status = Planning
Tier 2 Status = Design

The user should not need to select these values again unless they choose to change them.


---

# 14. Context Menu

Right-clicking a work item shall display a context menu.


## 14.1 Task Context Menu

Suggested actions:

- Open
- Edit
- Add Subtask
- Move To...
- Duplicate
- Archive
- Delete


## 14.2 Subtask Context Menu

Suggested actions:

- Open
- Edit
- Add Microtask
- Move To...
- Duplicate
- Archive
- Delete


## 14.3 Microtask Context Menu

Suggested actions:

- Open
- Edit
- Move To...
- Duplicate
- Archive
- Delete

Do not show "Add Child" because Microtask is the lowest supported hierarchy level.


---

# 15. Quick Move

Drag-and-drop shall not be the only method of changing status.

For boards containing many statuses, the user shall be able to use:

Right Click
→ Move To...


## 15.1 Move To Dialog

Example:

Move Task

Search destination:
[ test________________ ]

Results:

Testing
├── Test Preparation
├── Internal Testing
├── User Acceptance Testing
└── Final Verification


## 15.2 Destination Search

The Move To interface should allow searching by:

- Tier 1 Status
- Tier 2 Status

This is particularly important for workflows containing 20+ statuses.


---

# 16. Horizontal Scroll Awareness

The user shall always be visually informed when additional statuses exist outside the visible viewport.


## 16.1 Right Hidden Status Indicator

If statuses exist to the right:

                          ▶


## 16.2 Left Hidden Status Indicator

If statuses exist to the left:

◀


## 16.3 Both Directions

If statuses exist in both directions:

◀                        ▶


## 16.4 Edge Gradient

In addition to arrows, display a subtle gradient/glow along the relevant viewport edge.

Example:

████▓▒░                ░▒▓████
  ◀                        ▶


## 16.5 Hidden Status Count

Where practical, display the number of hidden statuses.

Example:

◀ 3                    5 ▶

Meaning:

- 3 statuses exist outside the viewport on the left.
- 5 statuses exist outside the viewport on the right.


## 16.6 Dynamic Indicator

When the user reaches the first status:

- hide the left indicator.

When the user reaches the last status:

- hide the right indicator.


---

# 17. Kanban Workflow Navigator / Minimap

For large workflows, provide an optional compact workflow navigator.

The navigator shall provide an overview of the complete status sequence.


## 17.1 Example

[01][02][03][04][05][06] ... [20]

            [==========]
             VIEWPORT


## 17.2 Navigator Interaction

Users may:

- view their current approximate position;
- click a status to navigate to it;
- drag the viewport indicator where appropriate.


## 17.3 Navigator Purpose

The navigator shall help the user maintain orientation when the Kanban contains many horizontally arranged statuses.


---

# 18. Sticky Status Headers

When vertically scrolling long status columns, the Tier 1 Status header shall remain visible.

Example:

IN PROGRESS                 17

The header may display:

- status name;
- task count;
- expand/collapse control;
- status menu.


---

# 19. Milestones

Milestones shall NOT be treated as normal Kanban statuses.

Status answers:

"Where is this work currently?"

Milestone answers:

"What significant checkpoint has been reached?"


## 19.1 Milestone Presentation

Milestones should visually overlay or cross the workflow.

Example:

BACKLOG
  →
PLANNING
  →
DESIGN
  →
APPROVAL
  →
IMPLEMENTATION
  →
TESTING

             ◆ Design Approved


## 19.2 Milestone Marker

A Milestone may be shown:

- between statuses;
- above status boundaries;
- on the workflow navigator;
- as a subtle cross-board marker.

A milestone shall not unnecessarily consume the same width as a normal status column.


---

# 20. Density Modes

The Kanban shall support multiple information-density modes.


## 20.1 Comfortable

Display relatively rich cards with information such as:

- task title;
- assignee;
- priority;
- due date;
- progress;
- relevant indicators.


## 20.2 Compact

Display reduced information.

Example:

| Configure Firewall     P1 |
| Migrate Application    P2 |
| Test DR                P1 |


## 20.3 Ultra Compact

Display primarily the task title and essential indicator.

Example:

● Configure Firewall
● Migrate Application
● Test DR


---

# 21. User Layout Preferences

The system should remember Kanban UI preferences per user where supported.

Preferences may include:

- expanded Tier 1 statuses;
- expanded Tier 2 statuses;
- density mode;
- filters;
- grouping;
- horizontal scroll position;
- workflow navigator visibility.


## 21.1 Temporary UI State

Temporary states shall NOT overwrite user preferences.

Examples include:

- Drop Bucket visibility;
- drag hover states;
- temporary destination highlighting;
- drag auto-scroll state;
- confirmation dialogs.


---

# 22. Status Colour Behaviour

Each Tier 1 Status may have its own primary colour.

Tier 2 statuses shall use related shades/variations of the Tier 1 colour.

The system shall not depend solely on colour to identify status.

Status name, position, and/or iconography must remain visible.


---

# 23. Drag Visual Feedback

During dragging, clearly distinguish:

- source status;
- valid destination;
- invalid destination;
- selected Tier 2 destination;
- potential drop position.


## 23.1 Invalid Drop

Invalid destinations shall visually reject the item.

The cursor/indicator should make it obvious that dropping is not permitted.


## 23.2 Original Position

Where practical, retain a visual placeholder at the original task location until the move is confirmed.

This helps the user understand where the task came from.


---

# 24. Popup Placement Rules

Drop Buckets and other temporary overlays shall attempt to remain completely inside the visible viewport.

If insufficient space exists:

- open to the left instead of right;
- open above instead of below;
- adjust vertical position;
- constrain popup height and allow internal scrolling.

Popup placement shall not require the main Kanban layout to move.


---

# 25. Long Tier 2 Lists

If a Tier 1 Status contains many Tier 2 statuses, the Drop Bucket shall remain compact.

Do not create an excessively tall popup.


## 25.1 Searchable Drop Bucket

For large Tier 2 lists, provide a search/filter field.

Example:

Move to Procurement

[ Search status...       ]

○ Requirement Review
○ Tender Preparation
○ Tender Approval
○ Tender Published
○ Evaluation
○ Award
○ Contract Preparation


## 25.2 Scrolling

If the list exceeds the available popup height:

- keep the popup size constrained;
- allow scrolling inside the Drop Bucket.


---

# 26. Card Counts

Where appropriate, Status headers may display counts.

Example:

PLANNING (12)

Tier 2 statuses may also display counts.

Example:

Requirements (5)
Design (3)
Approval (4)

Empty states may therefore be represented compactly as:

Approval (0)


---

# 27. Filtering Behaviour

When filters are active, the application shall clearly communicate that the board is filtered.

Example:

Filtered View
Showing 18 of 73 Tasks

Filters shall not cause users to assume that hidden tasks no longer exist.


---

# 28. Accessibility and Alternative Interaction

All major drag-and-drop operations should also be available without dragging.

Alternative mechanisms shall include:

- Move To...
- keyboard-accessible actions;
- context menu actions;
- status selection through task editing.

Critical functionality must not depend exclusively on mouse dragging.


---

# 29. Performance Requirements

The Kanban should avoid unnecessary rendering of off-screen content.

For large boards, implementation may use:

- horizontal virtualization;
- vertical card virtualization;
- lazy rendering of Tier 2 contents;
- lazy creation of Drop Bucket contents.

Temporary Drop Buckets shall preferably render only when required.


---

# 30. UX Priority Rules

Where multiple UI behaviours conflict, use the following priority:

1. Prevent accidental data changes.
2. Keep the user's current context visible.
3. Keep board geometry stable.
4. Make valid drop targets clear.
5. Minimize unnecessary popup activity.
6. Minimize empty screen space.
7. Provide alternative navigation for large workflows.
8. Preserve user-defined layout preferences.


---

# 31. Core Interaction Principle

The final Kanban interaction model shall follow:

NORMAL BOARD
│
├── Click Status
│   └── Persistent Expand/Collapse
│
├── Drag Work Item
│   │
│   ├── Pass Over Status
│   │   └── No immediate popup
│   │
│   └── Hover Over Status
│       │
│       └── Wait hover delay
│           │
│           └── Temporary Drop Bucket
│               │
│               ├── Select Tier 2 Status
│               │
│               └── Drop
│                   │
│                   └── Confirmation
│                       │
│                       └── Save
│                           │
│                           ├── Close Popup
│                           ├── Restore Board Layout
│                           └── Show Undo
│
├── Right Click Work Item
│   └── Context Menu
│
├── Move To...
│   └── Searchable Status Selector
│
├── + Add Task
│   └── Context-Aware Task Creation
│
└── Horizontal Navigation
    │
    ├── Edge Indicators
    ├── Hidden Status Counts
    ├── Auto Scroll
    └── Workflow Minimap


---

# 32. Key Design Rule

The implementation shall follow the following rule:

> Drag operations shall never unnecessarily modify the persistent geometry of the Kanban Board.

When additional hierarchy must be displayed during a drag operation, use temporary overlay Drop Buckets instead of physically expanding collapsed statuses.

The board should therefore remain visually stable while still allowing precise movement across Tier 1 and Tier 2 statuses.


---

# 33. Expected Result

The completed Kanban implementation should work effectively for:

- simple projects with only a few statuses;
- complex projects containing 20+ statuses;
- statuses containing many Tier 2 states;
- large numbers of Tasks/Subtasks/Microtasks;
- highly compact management views;
- detailed operational views.

The user should always be able to determine:

1. Where a work item currently resides.
2. Where it can be moved.
3. Whether additional statuses exist outside the viewport.
4. Whether a status contains Tier 2 states.
5. Whether a status is empty.
6. What change will occur before confirming a move.

The interface should maximize usable screen space while preventing the user from losing context during navigation or drag-and-drop operations.