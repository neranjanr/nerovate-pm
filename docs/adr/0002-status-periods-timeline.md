# Per-Status periods for execution timeline

Each Task keeps one whole-process start_date plus one period row per Status visited: start_date, due_date (planned end), actual_end_date, all optional. Current period is edited beside the Status selector; past periods are retained. Timeline is derived from periods, not from overwriting Task dates. We rejected Task-level dates only because the procurement example (request sent 01-01, approval received 10-01, quotes due 22-01, evaluation done 25-01) needs per-stage accountability.
