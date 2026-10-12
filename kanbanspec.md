# Kanban Board Specification

## 1. Purpose

Implement a Kanban Board for project tracking using the application's existing
Status Profile structure.

The Kanban Board shall support:

1. Tier 1 Statuses as the primary Kanban columns.
2. Tier 2 Statuses as detailed statuses within each Tier 1 Status.
3. Milestones as a separate project tracking dimension.
4. Progress percentage independently from Status and Milestone.
5. Compact and expanded Kanban views.
6. Expansion of Tier 1 columns to display individual Tier 2 Statuses when required.
7. Support for Status Profiles containing 20+ total statuses without making the
   normal Kanban view unnecessarily wide.

The Kanban Board shall NOT create a separate status structure.

It shall use the Status Profile already assigned to each project.


# 2. Core Data Model

A project's tracking information shall contain the following independent properties:

- Tier 1 Status
- Tier 2 Status
- Milestone
- Progress Percentage

Example:

Tier 1 Status: Implementation
Tier 2 Status: Equipment Installation
Milestone: M3
Progress: 65%


# 3. Status Hierarchy

Status Profiles shall maintain the existing two-tier hierarchy.

Example:

Planning
    Requirements Gathering
    Feasibility Review
    Design Preparation
    Design Approval

Procurement
    Specification Preparation
    RFQ/Tender Preparation
    Bid Invitation
    Bid Evaluation
    Approval
    Purchase Order

Implementation
    Site Preparation
    Equipment Delivery
    Installation Started
    Installation in Progress
    Configuration
    Integration

Testing
    Internal Testing
    User Acceptance Testing
    Defect Rectification
    Final Verification

Closure
    Documentation
    Final Acceptance
    Closure

A Status Profile may contain any reasonable number of Tier 1 and Tier 2 Statuses.


# 4. Standard Kanban View

The default Kanban Board shall display Tier 1 Statuses as columns.

Example:

| Planning | Procurement | Implementation | Testing | Closure |
|----------|-------------|----------------|---------|---------|
| Project A | Project C | Project D | Project F | Project H |
| Project B | Project E | Project G | | |

A project card shall be placed under the column corresponding to its current
Tier 1 Status.

Tier 2 Status shall NOT create a separate column in Standard View.


# 5. Project Card

Each Kanban card should display, where available:

- Project Name
- Tier 2 Status
- Progress Indicator
- Progress Percentage
- Current Milestone
- Responsible Person/Team, if applicable
- Target/Due Date, if applicable
- Special State indicators such as Blocked or On Hold

Example:

--------------------------------
Data Centre Migration

Installation in Progress
◕ 72%

Milestone 3 / 5
● ● ● ○ ○

Due: 30 Nov
--------------------------------

The Tier 1 Status does not need to be repeated prominently on the card because
the card's Kanban column already represents the Tier 1 Status.


# 6. Tier 1 Color Representation

Each Tier 1 Status may have its own configured color.

Example:

Planning        = Purple
Procurement     = Orange
Implementation  = Blue
Testing         = Cyan
Closure         = Green

Tier 1 color shall remain the primary color identity throughout its Tier 2
Statuses.


# 7. Tier 2 Visual Representation

Tier 2 Statuses shall NOT require a unique color for every status.

The Tier 1 color shall remain the base color.

Tier 2 visual distinction should use a combination of:

- Status label
- Progress icon
- Progress percentage
- Shade variation where appropriate
- Special-state icon where applicable

Suggested progress icons:

○ = Not Started
◔ = Early Progress
◑ = In Progress
◕ = Advanced
● = Nearly Complete
✓ = Complete

Example:

○  Requirements Gathering       5%
◔  Design Preparation          20%
◑  Procurement                 45%
◕  Installation                75%
●  Final Verification          95%
✓  Completed                  100%

The percentage is the primary precise progress indicator.

The icon provides quick visual recognition only.


# 8. Special State Indicators

Exceptional conditions shall be represented separately from normal progress.

Suggested indicators:

!  Attention Required
⛔ Blocked
‖  On Hold
×  Cancelled

For example:

⛔ Equipment Delivery
Progress: 45%

or

‖ Installation
Progress: 60%

A project being Blocked or On Hold shall not automatically alter its progress
percentage unless explicitly configured by the user.


# 9. Kanban Display Modes

The Kanban Board shall provide at least two display modes:

1. Standard View
2. Expanded Status View


# 10. Standard View

Standard View shall show Tier 1 statuses only as Kanban columns.

Example:

Planning | Procurement | Implementation | Testing | Closure

Tier 2 Status appears inside the project card.

This shall be the recommended default view because it provides a high-level
overview even when the Status Profile contains many Tier 2 Statuses.


# 11. Expanded Status View

The user shall be able to expand the Kanban Board to show individual Tier 2
Statuses.

Example:

STANDARD:

[ Planning ] [ Procurement ] [ Implementation ] [ Testing ]


EXPANDED:

Planning
  Requirements
  Design
  Approval

Procurement
  Specification
  Tender
  Evaluation
  PO

Implementation
  Site Preparation
  Delivery
  Installation
  Configuration
  Integration

Testing
  Internal Testing
  UAT
  Rectification
  Final Testing

In Expanded Status View, each Tier 2 Status shall function as a Kanban
sub-column or individual status column.

Projects shall appear under their exact Tier 2 Status.


# 12. Individual Tier 1 Expansion

The user should also be able to expand only a selected Tier 1 Status.

Example:

[ Planning ]

[ Procurement ]

[ Implementation ▼ ]
    Site Prep
    Delivery
    Installation
    Configuration
    Integration

[ Testing ]

This allows detailed investigation of one workflow stage without expanding the
entire Kanban Board.


# 13. Collapse / Expand Controls

Each Tier 1 Status shall support:

- Collapse
- Expand

The Kanban toolbar shall additionally provide:

- Standard View
- Expand All
- Collapse All

Suggested controls:

[Standard] [Expand All]

or

View:
(●) Tier 1
( ) All Statuses

Individual column:

Implementation                          [Expand ▾]

When expanded:

Implementation                          [Collapse ▴]

    Site Prep | Delivery | Installation | Configuration | Integration


# 14. Horizontal Scrolling

Expanded Status View may result in 20+ Kanban columns.

The board shall therefore support horizontal scrolling.

The application shall NOT attempt to reduce all expanded columns until 20+
statuses fit simultaneously on a normal desktop display.

Each status column shall maintain a usable minimum width.

The user can horizontally navigate through the expanded workflow.


# 15. Tier 1 Group Headers in Expanded View

When Tier 2 columns are expanded, they shall remain visually grouped under their
parent Tier 1 Status.

Example:

|----------- IMPLEMENTATION -----------|
| Site Prep | Delivery | Install | Config |

The parent Tier 1 color shall visually identify the group.

Tier 2 columns should use lighter/darker variations of the parent color without
requiring every Tier 2 Status to have a completely different color.


# 16. Drag and Drop

Kanban cards should support drag-and-drop status changes where permitted.

Standard View behavior:

Dragging a project from one Tier 1 column to another requires the system to
determine/select an appropriate Tier 2 Status under the destination Tier 1.

The application should NOT silently assign an arbitrary Tier 2 Status if
multiple valid destination Tier 2 Statuses exist.

In that situation, display a Tier 2 Status selection control.


Expanded View behavior:

Dragging a card directly to a Tier 2 column shall update:

- Tier 1 