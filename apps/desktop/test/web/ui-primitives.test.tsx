// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { X } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "../../src/web/components/ui/badge.js";
import { Button } from "../../src/web/components/ui/button.js";
import { Checkbox } from "../../src/web/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../../src/web/components/ui/dialog.js";
import { Input } from "../../src/web/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../src/web/components/ui/select.js";
import { Separator } from "../../src/web/components/ui/separator.js";
import { Switch } from "../../src/web/components/ui/switch.js";
import { Textarea } from "../../src/web/components/ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../src/web/components/ui/tooltip.js";

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

describe("shadcn UI primitives", () => {
  it("exposes stable slots and native form semantics", () => {
    render(
      <>
        <Input aria-label="标题" invalid />
        <Textarea aria-label="意见" />
        <Button>保存</Button>
      </>,
    );

    expect(screen.getByLabelText("标题")).toHaveAttribute("data-slot", "input");
    expect(screen.getByLabelText("标题")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("意见")).toHaveAttribute("data-slot", "textarea");
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute(
      "data-slot",
      "button",
    );
  });

  it("renders textual badges and semantic separators", () => {
    render(
      <>
        <Badge variant="review">待确认</Badge>
        <Separator />
      </>,
    );

    expect(screen.getByText("待确认")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByRole("separator")).toHaveAttribute(
      "data-slot",
      "separator",
    );
  });

  it("selects a Base UI option with the keyboard", async () => {
    render(
      <Select items={{ codex: "Codex", other: "Other" }} defaultValue="codex">
        <SelectTrigger aria-label="Agent 插件">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="codex">Codex</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "Agent 插件" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const currentOption = await screen.findByRole("option", { name: "Codex" });
    const nextOption = screen.getByRole("option", { name: "Other" });
    await waitFor(() => expect(currentOption).toHaveFocus());
    fireEvent.keyDown(currentOption, { key: "ArrowDown" });
    await waitFor(() => expect(nextOption).toHaveFocus());
    fireEvent.keyDown(nextOption, { key: "Enter" });

    await waitFor(() => expect(trigger).toHaveTextContent("Other"));
  });

  it("toggles an accessible checkbox", () => {
    render(
      <label>
        <Checkbox />
        启用
      </label>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "启用" });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("uses the registered primary color for switch checked state", () => {
    render(
      <>
        <Switch aria-label="自动合并" defaultChecked />
        <Switch aria-label="远程推送" disabled />
      </>,
    );

    const checked = screen.getByRole("switch", { name: "自动合并" });
    expect(checked).toBeChecked();
    expect(checked).toHaveAttribute("data-slot", "switch");
    expect(checked).toHaveClass("data-checked:bg-primary");
    expect(checked).not.toHaveClass("data-checked:bg-accent");
    expect(checked.querySelector('[data-slot="switch-thumb"]')).toHaveClass(
      "bg-[var(--surface)]",
    );

    const disabled = screen.getByRole("switch", { name: "远程推送" });
    expect(disabled).not.toBeChecked();
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(disabled);
    expect(disabled).not.toBeChecked();
  });

  it("centers the switch thumb with symmetric track insets", () => {
    render(<Switch aria-label="自动合并" defaultChecked />);

    const track = screen.getByRole("switch", { name: "自动合并" });
    const thumb = track.firstElementChild;
    expect(track).toHaveClass("items-center");
    expect(thumb).toHaveClass("translate-x-px");
    expect(thumb).toHaveClass("data-checked:translate-x-[17px]");
  });

  it("closes a dialog with Escape and restores trigger focus", async () => {
    render(
      <Dialog>
        <DialogTrigger render={<Button>新建 Issue</Button>} />
        <DialogContent>
          <DialogTitle>新建 Issue</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "新建 Issue" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "新建 Issue" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "新建 Issue" }),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("shows accessible help for an icon-only action", async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button aria-label="关闭" size="icon">
                <X />
              </Button>
            }
          />
          <TooltipContent>关闭</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    fireEvent.focus(screen.getByRole("button", { name: "关闭" }));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("关闭");
    expect(tooltip).toHaveClass(
      "bg-foreground",
      "text-background",
      "rounded-md",
      "px-2",
      "py-1.5",
    );
    expect(tooltip).not.toHaveClass("border", "border-border");
  });
});
