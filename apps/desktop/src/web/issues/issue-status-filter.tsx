import { ListFilter } from "lucide-react";

import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  issueStatusOptions,
  type IssueStatus,
} from "./issue-status-filter-model.js";

export function IssueStatusFilter({
  onToggle,
  selectedStatuses,
}: {
  onToggle: (status: IssueStatus) => void;
  selectedStatuses: ReadonlySet<IssueStatus>;
}) {
  const selectedCount = selectedStatuses.size;
  const totalCount = issueStatusOptions.length;
  const hiddenCount = totalCount - selectedCount;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={`筛选 Issue 状态，已选择 ${selectedCount} / ${totalCount}`}
            size="sm"
            type="button"
            variant="outline"
          />
        }
      >
        <ListFilter aria-hidden="true" size={13} />
        <span>状态</span>
        {hiddenCount > 0 ? <span className="status-filter-count">{hiddenCount}</span> : null}
      </PopoverTrigger>
      <PopoverContent aria-label="Issue 状态过滤器" className="status-filter-popover">
        <div className="status-filter-heading">
          <strong>展示状态</strong>
          <span>{selectedCount} / {totalCount}</span>
        </div>
        <div className="status-filter-options">
          {issueStatusOptions.map(([status, label]) => (
            <label className="status-filter-option" key={status}>
              <Checkbox
                checked={selectedStatuses.has(status)}
                onCheckedChange={() => onToggle(status)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
