import { X } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactElement } from "react";

import { api } from "../api/client.js";
import type { IssueDto, ProjectDto } from "../api/types.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Textarea } from "../components/ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

interface NewIssueDialogProps {
  open: boolean;
  trigger?: ReactElement;
  projects: ProjectDto[];
  onOpenChange(open: boolean): void;
  onCreated(issue: IssueDto): void;
}

export function NewIssueDialog({
  open,
  trigger,
  projects,
  onOpenChange,
  onCreated,
}: NewIssueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      {open ? (
        <NewIssueDialogContent
          projects={projects}
          onCreated={(issue) => {
            onCreated(issue);
            onOpenChange(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function NewIssueDialogContent({
  projects,
  onCreated,
}: {
  projects: ProjectDto[];
  onCreated(issue: IssueDto): void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canCreate = useMemo(
    () => Boolean(projectId && content.trim()),
    [content, projectId],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const issue = await api.submitManual({
        projectId,
        commandId: `manual-${Date.now()}`,
        content: content.trim(),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      });
      onCreated(issue);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Issue 创建失败");
      setBusy(false);
    }
  };

  return (
    <DialogContent aria-describedby={undefined} className="new-issue-dialog w-[min(520px,calc(100vw-32px))] gap-0 overflow-hidden p-0">
      <header>
        <DialogTitle>新建 Issue</DialogTitle>
        <CloseAction />
      </header>
      {projects.length ? (
        <form onSubmit={submit}>
          <label>
            项目
            <Select items={projects.map((project) => ({ label: project.name ?? project.key, value: project.id }))} value={projectId} onValueChange={(value) => {
              if (value !== null) setProjectId(value);
            }}>
              <SelectTrigger aria-label="项目">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name ?? project.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            摘要（可选）
            <Input
              aria-label="摘要（可选）"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <label>
            问题内容
            <Textarea
              aria-label="问题内容"
              autoFocus
              required
              rows={5}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer>
            <DialogClose render={<Button type="button" variant="outline" />}>
              取消
            </DialogClose>
            <Button disabled={!canCreate || busy} type="submit">
              {busy ? "创建中…" : "创建并开始分析"}
            </Button>
          </footer>
        </form>
      ) : (
        <div className="new-issue-empty">
          <p>请先添加一个本机项目。</p>
          <DialogClose render={<Button type="button" variant="outline" />}>
            关闭
          </DialogClose>
        </div>
      )}
    </DialogContent>
  );
}

function CloseAction() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DialogClose
            render={
              <Button aria-label="关闭" size="icon-sm" type="button" variant="ghost">
                <X aria-hidden="true" size={16} />
              </Button>
            }
          />
        }
      />
      <TooltipContent>关闭</TooltipContent>
    </Tooltip>
  );
}
