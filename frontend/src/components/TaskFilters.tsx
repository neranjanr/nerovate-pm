export interface TaskFilterState {
  search: string;
  statusId: string;
  stageId: string;
  assigneeId: string;
  watcherId: string;
  tag: string;
  depth: string;
  blocked: string;
  overdue: string;
}

export const EMPTY_FILTERS: TaskFilterState = {
  search: "",
  statusId: "",
  stageId: "",
  assigneeId: "",
  watcherId: "",
  tag: "",
  depth: "",
  blocked: "",
  overdue: "",
};

/** Single query builder shared by List/Calendar/Table (T8 parity rule). U5: stage_id. */
export function buildTaskQuery(projectId: string, f: TaskFilterState): string {
  const p = new URLSearchParams({ project_id: projectId });
  if (f.search.trim()) p.set("search", f.search.trim());
  if (f.statusId) p.set("status", f.statusId);
  if (f.stageId) p.set("stage_id", f.stageId);
  if (f.assigneeId) p.set("assignee", f.assigneeId);
  if (f.watcherId) p.set("watcher", f.watcherId);
  if (f.tag.trim()) p.set("tag", f.tag.trim());
  if (f.depth) p.set("depth", f.depth);
  if (f.blocked) p.set("blocked", f.blocked);
  if (f.overdue) p.set("overdue", f.overdue);
  return p.toString();
}

export interface StageOption {
  id: number;
  name: string;
}

interface Props {
  filters: TaskFilterState;
  onChange: (f: TaskFilterState) => void;
  statuses: { id: number; name: string; stage_id?: number | null }[];
  stages?: StageOption[];
}

export default function TaskFilters({ filters, onChange, statuses, stages }: Props) {
  const set = (patch: Partial<TaskFilterState>) => onChange({ ...filters, ...patch });
  const visibleStatuses = filters.stageId
    ? statuses.filter((s) => String(s.stage_id ?? "") === filters.stageId)
    : statuses;
  return (
    <div className="flex flex-wrap items-center gap-2 bg-surface-container-low border border-subtle rounded p-2 text-xs">
      <input
        aria-label="search tasks"
        placeholder="Search title/description..."
        className="px-2.5 py-1.5 rounded bg-surface-container border border-subtle text-on-surface w-52"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <select
        aria-label="filter by status"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
        value={filters.statusId}
        onChange={(e) => set({ statusId: e.target.value })}
      >
        <option value="">All statuses</option>
        {visibleStatuses.map((s) => (
          <option key={s.id} value={String(s.id)}>
            {s.name}
          </option>
        ))}
      </select>
      {stages !== undefined && stages.length > 0 && (
        <select
          aria-label="filter by stage"
          className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
          value={filters.stageId}
          onChange={(e) => set({ stageId: e.target.value, statusId: "" })}
        >
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <input
        aria-label="filter by assignee"
        placeholder="Assignee id"
        inputMode="numeric"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface w-28"
        value={filters.assigneeId}
        onChange={(e) => set({ assigneeId: e.target.value.replace(/[^0-9]/g, "") })}
      />
      <input
        aria-label="filter by watcher"
        placeholder="Watcher id"
        inputMode="numeric"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface w-28"
        value={filters.watcherId}
        onChange={(e) => set({ watcherId: e.target.value.replace(/[^0-9]/g, "") })}
      />
      <input
        aria-label="filter by tag"
        placeholder="Tag"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface w-28"
        value={filters.tag}
        onChange={(e) => set({ tag: e.target.value })}
      />
      <select
        aria-label="filter by depth"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
        value={filters.depth}
        onChange={(e) => set({ depth: e.target.value })}
      >
        <option value="">All depths</option>
        <option value="0">Task (0)</option>
        <option value="1">Subtask (1.1)</option>
        <option value="2">Microtask (1.1.1)</option>
      </select>
      <select
        aria-label="filter blocked"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
        value={filters.blocked}
        onChange={(e) => set({ blocked: e.target.value })}
      >
        <option value="">Blocked: all</option>
        <option value="true">Blocked only</option>
        <option value="false">Not blocked</option>
      </select>
      <select
        aria-label="filter overdue"
        className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
        value={filters.overdue}
        onChange={(e) => set({ overdue: e.target.value })}
      >
        <option value="">Overdue: all</option>
        <option value="true">Overdue only</option>
        <option value="false">Not overdue</option>
      </select>
      <button
        onClick={() => onChange({ ...EMPTY_FILTERS })}
        className="px-2.5 py-1.5 rounded bg-surface-container hover:bg-surface-container-high border border-subtle text-on-surface-variant"
      >
        Reset
      </button>
    </div>
  );
}
