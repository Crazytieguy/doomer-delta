import { useMutation } from "convex/react";
import { AlertTriangle, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useToast } from "./ToastContext";

interface DeleteModelDialogProps {
  modelId: Id<"models">;
  modelName: string;
  onDeleted?: () => void | Promise<void>;
}

export interface DeleteModelDialogRef {
  openDialog: () => void;
}

export const DeleteModelDialog = forwardRef<
  DeleteModelDialogRef,
  DeleteModelDialogProps
>(function DeleteModelDialog({ modelId, modelName, onDeleted }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const removeMutation = useMutation(api.models.remove);
  const { showSuccess, showError } = useToast();

  const openDialog = () => {
    dialogRef.current?.showModal();
  };

  useImperativeHandle(ref, () => ({
    openDialog,
  }));

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      await removeMutation({ id: modelId });
      showSuccess("Model deleted successfully");
      closeDialog();
      await onDeleted?.();
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="modal" style={{ zIndex: 9999 }}>
      <div className="modal-box max-w-md">
        <button
          onClick={closeDialog}
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          aria-label="Close"
          disabled={isSubmitting}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-error/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-error" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg mt-0">Delete Model</h3>
            <p className="text-base-content/80 mt-2">
              Are you sure you want to delete{" "}
              <strong className="text-base-content">{modelName}</strong>? This
              action cannot be undone.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button
            onClick={closeDialog}
            className="btn btn-ghost"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleDelete()}
            className="btn btn-error"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
      <div
        className="modal-backdrop"
        onClick={() => {
          if (!isSubmitting) closeDialog();
        }}
      >
        <button type="button">close</button>
      </div>
    </dialog>
  );
});
