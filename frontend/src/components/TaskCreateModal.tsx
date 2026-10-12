import TaskDialog from "./TaskDialog";

interface TaskCreateModalProps {
  projectId: string | number;
  parentId?: number | null;
  parentTitle?: string | null;
  /** Depth label: Task / Subtask / Microtask */
  kind?: "Task" | "Subtask" | "Microtask";
  onClose: () => void;
  onCreated: (taskId?: number) => void;
}

/**
 * Create entry point kept for List/Board call sites. Delegates to the unified
 * TaskDialog (create mode): full fields per sampleaddtask.html — level
 * switcher, same-Project parent picker, Category-profile Status grouped by
 * Stage, priority, assignee/watchers, Task + period dates, initial comment.
 */
export default function TaskCreateModal({
  projectId,
  parentId = null,
  parentTitle = null,
  kind = "Task",
  onClose,
  onCreated,
}: TaskCreateModalProps) {
  return (
    <TaskDialog
      projectId={projectId}
      mode="create"
      initialParentId={parentId}
      initialKind={kind}
      parentTitle={parentTitle}
      onClose={onClose}
      onCreated={(taskId) => onCreated(taskId)}
    />
  );
}
