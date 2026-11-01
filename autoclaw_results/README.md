# autoclaw_results/

AutoClaw 把每个任务的产出一份 MD 写到这里，文件名 = `task_id.md`。

DSH 侧验收看三件事：`status` 字段、`changed_files` 里的文件在磁盘上是否真的存在且 mtime 晚于派活时间、以及 coding 任务必须有 `code_review` 字段。

约定（见 `C:\Users\A005490\AppData\Roaming\dsh-desktop\harness\skills\autoclaw-dispatch\SKILL.md`，该技能 2026-10-27 更新过）：

```
# 结果：<task_id>

- status: done | blocked | needs-input
- summary: ...
- changed_files: [...]
- code_review: passed | issues-found + 问题与修复摘要（coding 任务必填）
- issues: ...
- evidence: ...
```

不写 `status` 或写别的值的，DSH 会当作未完成。

**两条硬约定**（技能 2026-10-27 新增）：

1. **并行**：任务里有互不依赖的子任务时，DSH 会在任务单里明确要求用 subagent 并行；subagent 嵌套上限 2 层；有共享可变状态 / 会改同一文件的子任务不许并行。
2. **代码评审**：凡涉及写代码/改代码，DSH 会在任务单里要求做 code-review（自审或派独立 subagent，推荐后者）；评审不过关时 `status` 不得写 `done`，应写 `blocked` / `needs-input`。`code_review` 写 `passed` 即代表真的审过，DSH 会把它当必查项。