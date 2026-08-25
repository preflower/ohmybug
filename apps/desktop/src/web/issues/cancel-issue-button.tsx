import { useState } from "react";

import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";

export function CancelIssueButton({
  disabled,
  onCancel,
}: {
  disabled?: boolean;
  onCancel(): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onCancel();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消失败");
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Button
      disabled={disabled || busy}
      type="button"
      variant="secondary"
      onClick={() => {
        setError("");
        setOpen(true);
      }}
    >取消 Issue</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认取消 Issue？</DialogTitle>
          <DialogDescription>Issue 将进入“已取消”终态，之后不能继续执行。</DialogDescription>
        </DialogHeader>
        {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter>
          <DialogClose render={<Button disabled={busy} type="button" variant="secondary" />}>返回</DialogClose>
          <Button disabled={busy} type="button" variant="destructive" onClick={() => void confirm()}>
            {busy ? "取消中…" : "确认取消"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
