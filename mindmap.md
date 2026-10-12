# RHS Mind Map View Specification

## 1. Feature Overview

The application shall provide a **Mind Map** view inside the Right-Hand Side (RHS) panel.

The Mind Map shall visually represent the existing work hierarchy:

```text
Category
└── Project
    └── Task
        └── Sub Task
            └── Micro Task
```

The displayed Mind Map scope shall be determined by the item currently selected by the user.

The default visualization shall focus on the following levels for clarity:

```text
Category → Project → Task
```

Deeper levels shall remain available through configurable depth controls and branch-level expansion.

---

## 2. Objectives

The Mind Map view shall:

1. Provide a visual overview of Projects and their work items.
2. Allow users to understand relationships between Tasks, Sub Tasks, and Micro Tasks.
3. Preserve the full Project context when any item within a Project is selected.
4. Display all Projects belonging to a selected Category.
5. Allow users to progressively expand deeper hierarchy levels.
6. Reuse the application's existing status colors, milestones, filters, and permissions.
7. Remain usable for Categories and Projects containing a large number of work items.

---

## 3. RHS Panel Integration

The Mind Map shall be available as a view within the RHS panel.

Suggested RHS panel tabs or view options:

```text
Details | Tasks | Mind Map
```

Selecting **Mind Map** shall display the visualization without navigating away from the current page.

The Mind Map shall automatically resize when:

- The RHS panel is resized.
- The RHS panel is expanded or collapsed.
- The browser window size changes.
- The device orientation changes.

The user shall be able to expand the RHS panel to obtain a larger Mind Map workspace.

---

## 4. Selection and Scope Rules

### 4.1 Category Selection

When a user selects a Category, the Mind Map shall:

1. Use the selected Category as the root node.
2. Load all active and accessible Projects assigned to that Category.
3. Load the Tasks belonging to each included Project, subject to the selected display depth.
4. Treat all Projects in the Category as part of one Category-level Mind Map.
5. Apply active filters and user permissions.

Example:

```text
Selected Category
├── Project A
│   ├── Task A1
│   ├── Task A2
│   └── Task A3
├── Project B
│   ├── Task B1
│   └── Task B2
└── Project C
    ├── Task C1
    └── Task C2
```

If the selected Category contains no accessible Projects, the Mind Map shall display an empty-state message.

### 4.2 Project Selection

When a user selects a Project, the Mind Map shall:

1. Use the selected Project as the root node.
2. Load the full Project hierarchy.
3. Include all accessible Tasks, Sub Tasks, and Micro Tasks belonging to that Project.
4. Initially display only the levels allowed by the current depth setting.
5. Keep deeper levels available for expansion.

### 4.3 Task Selection

When a user selects a Task, the Mind Map shall **not** display only the selected Task branch.

Instead, the application shall:

1. Resolve the parent Project of the selected Task.
2. Load the full Mind Map of that parent Project.
3. Include all accessible Tasks in the Project.
4. Include deeper descendants according to the selected depth setting.
5. Automatically expand the hierarchy required to reveal the selected Task.
6. Highlight the selected Task.
7. Pan and zoom the Mind Map to bring the selected Task into view.

### 4.4 Sub Task Selection

When a user selects a Sub Task, the application shall:

1. Resolve the parent Task and parent Project.
2. Load the full Mind Map of the parent Project.
3. Automatically expand the selected Sub Task's ancestor path.
4. Highlight the selected Sub Task.
5. Bring the selected Sub Task into view.

### 4.5 Micro Task Selection

When a user selects a Micro Task, the application shall:

1. Resolve the parent Sub Task, Task, and Project.
2. Load the full Mind Map of the parent Project.
3. Automatically expand the full ancestor path to the selected Micro Task.
4. Highlight the selected Micro Task.
5. Bring the selected Micro Task into view.

### 4.6 Selection Scope Summary

| Selected Item | Mind Map Root | Mind Map Scope | Selected Item Behaviour |
|---|---|---|---|
| Category | Selected Category | All accessible Projects in the Category | Highlight Category root |
| Project | Selected Project | Full selected Project | Highlight Project root |
| Task | Parent Project | Full parent Project | Reveal and highlight Task |
| Sub Task | Parent Project | Full parent Project | Expand path and highlight Sub Task |
| Micro Task | Parent Project | Full parent Project | Expand path and highlight Micro Task |

---

## 5. Hierarchy and Node Relationships

Each Mind Map node shall represent one application entity:

- Category
- Project
- Task
- Sub Task
- Micro Task

Parent-child relationships shall follow the application's stored hierarchy.

A child node shall not appear under an unrelated parent.

The Mind Map shall use stable entity identifiers rather than display names to resolve relationships and selection state.

Each visible node shall retain at least:

```text
entityId
entityType
parentId
projectId
categoryId
name
statusId
statusTier
progress
isMilestone
hasChildren
childCount
isSelected
```

---

## 6. Default Display Depth

### 6.1 Category Root

When the Mind Map root is a Category, the default visible hierarchy shall be:

```text
Category → Project → Task
```

Sub Tasks and Micro Tasks shall be loaded or retrieved as required but remain collapsed by default.

### 6.2 Project Root

When the Mind Map root is a Project, the default visible hierarchy shall be:

```text
Project → Task
```

Sub Tasks and Micro Tasks shall remain collapsed by default unless required to reveal the currently selected item.

### 6.3 Selected Descendant Override

If a Task, Sub Task, or Micro Task is selected, the application shall automatically reveal the full ancestor path to that item even when the current default depth would normally hide it.

This automatic expansion shall apply only to the required branch. Other branches shall remain at the current display depth.

---

## 7. Depth Control

The Mind Map toolbar shall provide a **Depth** selector.

Recommended options:

```text
Overview
Tasks
Sub Tasks
Full Hierarchy
```

The meaning of each option shall adapt to the current root type.

### 7.1 Category Mind Map Depth

| Option | Visible Levels |
|---|---|
| Overview | Category → Projects |
| Tasks | Category → Projects → Tasks |
| Sub Tasks | Category → Projects → Tasks → Sub Tasks |
| Full Hierarchy | Category → Projects → Tasks → Sub Tasks → Micro Tasks |

### 7.2 Project Mind Map Depth

| Option | Visible Levels |
|---|---|
| Overview | Project → Tasks |
| Sub Tasks | Project → Tasks → Sub Tasks |
| Full Hierarchy | Project → Tasks → Sub Tasks → Micro Tasks |

The application should remember the user's most recently selected depth preference.

---

## 8. Expand and Collapse Behaviour

Any node with child items shall provide an expand/collapse control.

The user shall be able to:

- Expand one node.
- Collapse one node.
- Expand an entire branch.
- Collapse an entire branch.
- Expand all nodes up to the selected depth.
- Collapse all nodes to the root or default depth.

Expanding a node shall reveal its immediate children.

Collapsing a node shall hide all descendants of that node without changing their underlying data.

The selected node and its ancestor path shall not be hidden automatically. If the user manually collapses an ancestor of the selected node, the selected node may become hidden while the ancestor remains selected or marked as containing the current selection.

---

## 9. Node Presentation

Each node should display only the most relevant information to avoid visual clutter.

Recommended node content:

- Item name
- Entity type indicator
- Current status
- Status color
- Progress percentage, where available
- Milestone indicator, where applicable
- Child count, where useful
- Overdue or attention indicator, where already supported by the application

Optional information may be displayed in a tooltip or detail popover:

- Full item name
- Description summary
- Assignee or owner
- Start date
- Due date
- Status and sub-status
- Progress
- Parent item
- Number of child items

Long node names shall be truncated visually, with the full name available through a tooltip.

---

## 10. Status and Milestone Visualization

The Mind Map shall reuse the existing Status Profile configuration.

### 10.1 Status Colors

- Tier 1 status colors shall be the primary status indication.
- Tier 2 statuses may use the application's configured shade or variation logic.
- The Mind Map shall not create a separate status color system.
- Status colors shall remain consistent with List, Kanban, Timeline, and other application views.

### 10.2 Milestones

Milestones shall remain separate from statuses.

A milestone may be represented by:

- A milestone icon
- A node badge
- A node border indicator
- Another existing milestone visual used by the application

Milestone presentation shall not replace the node's status color.

---

## 11. User Interaction

### 11.1 Single Click

Single-clicking a node shall:

1. Select the node.
2. Update the application's current selection state.
3. Display the corresponding item details where applicable.
4. Keep the current Mind Map scope unchanged.

For example, selecting a Task node inside a Project Mind Map shall not redraw the Mind Map using only that Task as the root.

### 11.2 Double Click

Double-clicking a node may open the full details or edit page for that item, subject to the application's existing navigation behaviour.

### 11.3 Context Menu

Where permitted, right-clicking or opening the node action menu may provide:

- Open
- Edit
- Add Child Item
- Change Status
- Manage Milestone
- Expand Node
- Collapse Node
- Expand Branch
- Collapse Branch
- Focus on Node

Available actions shall follow the user's permissions and the entity type.

### 11.4 Focus on Node

The **Focus on Node** action may center and zoom to a selected node without changing the Mind Map root or scope.

---

## 12. Toolbar Controls

The Mind Map toolbar should provide:

```text
[Fit to View] [Zoom Out] [Zoom In] [Expand] [Collapse]
Depth: [Tasks ▼]
Layout: [Horizontal ▼]
[Reset View]
```

Recommended controls:

- Fit to View
- Zoom In
- Zoom Out
- Reset Zoom
- Reset Position
- Expand All to Selected Depth
- Collapse All
- Depth Selector
- Layout Selector
- Full-Screen or Expanded RHS View
- Search Within Mind Map

---

## 13. Layout Options

The default layout shall be **Horizontal**, flowing from left to right.

```text
Category → Project → Task → Sub Task → Micro Task
```

Optional layouts may include:

- Horizontal
- Vertical
- Radial

Changing the layout shall not change the root, selection, hierarchy, filtering, or expanded state.

---

## 14. Navigation, Zoom, and Pan

The Mind Map shall support:

- Zoom in
- Zoom out
- Mouse wheel or trackpad zoom, where appropriate
- Click-and-drag panning
- Fit to View
- Center on selected node
- Reset view

When the Mind Map is first loaded, it shall automatically fit the relevant visible nodes into the available panel space.

If a Task, Sub Task, or Micro Task initiated the Mind Map load, the selected item shall be brought into view after the layout is calculated.

---

## 15. Filtering and Search

The Mind Map shall respect active application filters, including applicable filters for:

- Status
- Sub-status
- Category
- Project
- Assignee
- Milestone
- Date range
- Search text
- Archived or active state

Filtered-out nodes shall not be displayed unless they are required as structural ancestors of a visible matching node.

When an ancestor is shown only to preserve the hierarchy, it may be visually dimmed or marked as a structural node.

A **Search Within Mind Map** function should:

1. Search visible and loaded nodes.
2. Highlight matching nodes.
3. Allow next and previous match navigation.
4. Expand the required ancestor path to a selected search result.
5. Center the selected result in the viewport.

---

## 16. Permissions and Data Visibility

The Mind Map shall apply the same authorization rules used elsewhere in the application.

Users shall only see Categories, Projects, Tasks, Sub Tasks, and Micro Tasks they are authorized to view.

If a user can view a child item but cannot view some related details, restricted information shall not be exposed through:

- Node labels
- Tooltips
- Child counts
- Context menus
- Search results
- Hidden node metadata

Actions such as edit, add, delete, change status, or manage milestones shall only appear when authorized.

---

## 17. Large Mind Map Handling

The application shall avoid presenting every hierarchy level in an expanded state for large Categories or Projects.

For large Mind Maps:

1. Use the default display depth.
2. Keep deeper levels collapsed.
3. Load child nodes when required if lazy loading is supported.
4. Preserve zoom and pan responsiveness.
5. Avoid re-rendering unaffected branches.
6. Allow users to expand one branch at a time.
7. Provide Fit to View and Collapse All controls.
8. Display a loading state while additional branches are retrieved or rendered.

If a Category contains many Projects, the Category root shall still represent the complete Category scope, but branches may be progressively rendered or expanded to preserve usability.

---

## 18. Loading Behaviour

### 18.1 Category Load

On Category selection:

1. Resolve the selected Category.
2. Retrieve all accessible Projects assigned to it.
3. Retrieve or prepare child nodes required by the selected depth.
4. Build the Category-rooted hierarchy.
5. Render the Mind Map.
6. Fit the visible graph into the RHS panel.

### 18.2 Project or Descendant Load

On Project, Task, Sub Task, or Micro Task selection:

1. Resolve the selected entity.
2. Resolve its parent Project when the selected entity is below Project level.
3. Retrieve the full accessible hierarchy of that Project.
4. Use the Project as the Mind Map root.
5. Apply the active depth setting.
6. Expand the ancestor path to the selected entity.
7. Highlight the selected entity.
8. Render the Mind Map.
9. Bring the selected entity into view.

### 18.3 Loading States

The RHS panel shall provide clear states for:

- Loading initial Mind Map
- Loading a branch
- No Projects in Category
- Project contains no Tasks
- No results after filtering
- Access restricted
- Data load failure
- Layout or rendering failure

A failure in one optional branch should not remove already loaded valid branches where partial display is technically possible.

---

## 19. State Preservation

While the user remains in the current workspace, the application should preserve:

- Selected depth
- Layout mode
- Zoom level
- Pan position
- Expanded and collapsed branches
- Selected node

When the Mind Map scope changes to another Category or Project, the application may reset zoom and position, then fit the new map to view.

When the user returns to a previously viewed Project, the application may restore that Project's previous Mind Map state.

---

## 20. Data Refresh and Synchronization

The Mind Map shall remain synchronized with the underlying application data.

When an item is created, edited, moved, deleted, or changes status:

- The affected node shall be updated.
- Parent-child relationships shall be recalculated when required.
- The full Mind Map should not be reloaded unless necessary.
- The current selection should be preserved where possible.
- The user's zoom and pan position should be preserved where possible.

If the selected item is deleted or becomes inaccessible, the Mind Map shall select the nearest accessible parent or return to the current root node.

---

## 21. Empty States

Recommended empty-state messages:

```text
This Category does not contain any Projects.
```

```text
This Project does not contain any Tasks.
```

```text
No items match the currently applied filters.
```

```text
You do not have permission to view items in this selection.
```

The empty state should provide a relevant action when authorized, such as **Add Project**, **Add Task**, or **Clear Filters**.

---

## 22. Accessibility

The Mind Map shall support accessible interaction where practical.

Requirements should include:

- Keyboard navigation between nodes
- Visible focus indicators
- Accessible node labels
- Status information that does not depend only on color
- Sufficient contrast
- Tooltips or labels for icons
- Screen-reader-compatible node names and hierarchy levels
- Keyboard-accessible expand and collapse controls
- Keyboard-accessible toolbar actions

---

## 23. Responsive Behaviour

On narrow RHS panels:

- The toolbar may collapse into a compact menu.
- Node details may be reduced to the item name and key indicator.
- Horizontal scrolling shall be avoided in favor of canvas pan.
- The user shall be able to expand the RHS panel.

On small screens, the application may open the Mind Map in an expanded panel or full-screen view while preserving the same selection and scope rules.

---

## 24. Acceptance Criteria

### AC-01: Category Selection

Given a Category is selected, when the user opens the Mind Map, then the selected Category shall be the root and all accessible Projects belonging to that Category shall be included.

### AC-02: Project Selection

Given a Project is selected, when the user opens the Mind Map, then the selected Project shall be the root and the full Project hierarchy shall be available.

### AC-03: Task Selection

Given a Task is selected, when the Mind Map is opened, then the full parent Project Mind Map shall load, the Task shall be revealed and highlighted, and the Mind Map shall not be limited to the selected Task branch.

### AC-04: Sub Task Selection

Given a Sub Task is selected, when the Mind Map is opened, then the full parent Project Mind Map shall load and the ancestor path to the Sub Task shall be expanded.

### AC-05: Micro Task Selection

Given a Micro Task is selected, when the Mind Map is opened, then the full parent Project Mind Map shall load and the complete ancestor path to the Micro Task shall be expanded.

### AC-06: Default Category Depth

Given a Category Mind Map is opened without a saved depth preference, then Category, Project, and Task levels shall be visible by default.

### AC-07: Default Project Depth

Given a Project Mind Map is opened without a saved depth preference, then the Project and Task levels shall be visible by default.

### AC-08: Deeper Hierarchy

Given deeper work items exist, when the user expands a branch or selects a deeper display depth, then Sub Tasks and Micro Tasks shall become visible according to the selected option.

### AC-09: Scope Stability

Given a Project Mind Map is already loaded, when the user selects a Task node, then the Project shall remain the root and the full Project scope shall remain loaded.

### AC-10: Status Consistency

Given nodes have assigned statuses, when the Mind Map is rendered, then the existing Status Profile colors and indicators shall be used.

### AC-11: Milestone Consistency

Given an item is marked as a milestone, when its node is rendered, then a milestone indicator shall appear without replacing its status indication.

### AC-12: Filtering

Given application filters are active, when the Mind Map is rendered, then the results shall follow those filters while retaining required structural ancestors.

### AC-13: Permissions

Given the user lacks access to an item, when the Mind Map is loaded, then the restricted item and its protected details shall not be exposed.

### AC-14: Fit and Focus

Given a Task, Sub Task, or Micro Task initiated the load, when rendering completes, then the selected node shall be highlighted and brought into view.

### AC-15: Expand and Collapse

Given a node contains children, when the user uses its expand or collapse control, then only the relevant branch shall change visibility.

### AC-16: Empty Category

Given a selected Category contains no accessible Projects, when the Mind Map is opened, then a suitable empty-state message shall be displayed.

### AC-17: Empty Project

Given a selected Project contains no accessible Tasks, when the Mind Map is opened, then a suitable empty-state message shall be displayed.

### AC-18: RHS Resize

Given the RHS panel is resized, when its dimensions change, then the Mind Map canvas shall resize without losing the selected node or hierarchy state.

---

## 25. Recommended Default Behaviour

The recommended initial behaviour is:

```text
Category selected:
Load Category → All Projects in Category → Tasks

Project selected:
Load Full Project → Tasks

Task selected:
Load Full Parent Project → Reveal and highlight selected Task

Sub Task selected:
Load Full Parent Project → Expand path → Highlight selected Sub Task

Micro Task selected:
Load Full Parent Project → Expand path → Highlight selected Micro Task
```

Sub Tasks and Micro Tasks shall be supported but shall not be expanded across the entire Mind Map by default.

This approach provides a clear management-level overview while allowing users to drill down to the lowest work-item level when required.
