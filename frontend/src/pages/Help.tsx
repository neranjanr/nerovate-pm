export default function Help() {
  return (
    <main className="p-8 bg-surface min-h-screen text-on-surface max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Nerovate-PM Help & Documentation</h1>
      <p className="text-sm text-on-surface-variant mb-6">
        Single on-prem system for 20 users. One context for categories, projects, tasks, and execution timeline.
      </p>

      <div className="space-y-6 text-sm">
        <section className="bg-surface-container-lowest border border-subtle rounded-lg p-5">
          <h2 className="text-base font-semibold text-primary mb-2">Navigation Toolbar</h2>
          <p className="text-on-surface-variant mb-2">
            Use the global top bar to switch between views:
          </p>
          <ul className="list-disc list-inside space-y-1 text-on-surface-variant font-mono text-xs">
            <li><strong>Projects:</strong> View categories, project directories, and individual project boards, lists, timelines, and project settings.</li>
            <li><strong>Settings:</strong> Manage global Status Profiles, stages, statuses, colors, and order.</li>
            <li><strong>Help:</strong> Access system documentation and terminology.</li>
          </ul>
        </section>

        <section className="bg-surface-container-lowest border border-subtle rounded-lg p-5">
          <h2 className="text-base font-semibold text-primary mb-2">Domain Terminology</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-surface p-3 rounded border border-subtle">
              <strong className="text-on-primary block mb-1">Category</strong>
              <span className="text-on-surface-variant">A named grouping of Projects with a stable unique ID and display color (e.g. Procurements, OPEX Items).</span>
            </div>
            <div className="bg-surface p-3 rounded border border-subtle">
              <strong className="text-on-primary block mb-1">Project</strong>
              <span className="text-on-surface-variant">A unit of procurement or recurring work inside a Category with code, start date, and status profile.</span>
            </div>
            <div className="bg-surface p-3 rounded border border-subtle">
              <strong className="text-on-primary block mb-1">Task Hierarchy</strong>
              <span className="text-on-surface-variant">Tasks (depth 0) › Subtasks (depth 1, e.g. 1.1) › Microtasks (depth 2, e.g. 1.1.1).</span>
            </div>
            <div className="bg-surface p-3 rounded border border-subtle">
              <strong className="text-on-primary block mb-1">Status Profile & Stages</strong>
              <span className="text-on-surface-variant">Ordered set of Status Stages (e.g. Prior Approval, Procurement Stage) containing ordered leaf Statuses with custom colors.</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
