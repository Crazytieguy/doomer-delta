import { useMutation, useQuery } from "convex/react";
import { Mail, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useToast } from "./ToastContext";

interface ShareDialogProps {
  modelId: Id<"models">;
}

export function ShareDialog({ modelId }: ShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sharedUsers = useQuery(api.models.listSharedUsers, { modelId });
  const shareMutation = useMutation(api.models.share);
  const unshareMutation = useMutation(api.models.unshare);
  const { showSuccess, showError } = useToast();

  const openDialog = () => {
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
    setEmail("");
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      await shareMutation({ modelId, email: email.trim() });
      showSuccess("Model shared successfully");
      setEmail("");
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnshare = async (userId: Id<"users">) => {
    try {
      await unshareMutation({ modelId, userId });
      showSuccess("Access revoked");
    } catch (error) {
      showError(error);
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      setEmail("");
    };

    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  return (
    <>
      <button
        onClick={openDialog}
        className="btn btn-outline btn-sm"
        aria-label="Share model"
      >
        <UserPlus className="w-4 h-4" />
        Share
      </button>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box">
          <button
            onClick={closeDialog}
            className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <h3 className="font-bold text-lg mt-0">Share Model</h3>

          <div className="mb-6">
            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Email address</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/50 z-10" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && email.trim() && !isSubmitting) {
                        void handleShare(e as any);
                      }
                    }}
                    placeholder="user@example.com"
                    className="input input-border w-full pl-10"
                    disabled={isSubmitting}
                  />
                </div>
                <button
                  type="button"
                  onClick={(e) => void handleShare(e as any)}
                  className="btn btn-primary"
                  disabled={isSubmitting || !email.trim()}
                >
                  Share
                </button>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-2 mt-0">Shared with</h4>
            {!sharedUsers || sharedUsers.length === 0 ? (
              <p className="text-base-content/60 text-sm">
                Not shared with anyone yet
              </p>
            ) : (
              <ul className="space-y-2">
                {sharedUsers.map((user) => (
                  <li
                    key={user._id}
                    className="flex items-center justify-between py-2 px-3 bg-base-200 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {user.name || "Unknown"}
                      </div>
                      <div className="text-sm text-base-content/60 truncate">
                        {user.email}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleUnshare(user._id)}
                      className="btn btn-ghost btn-sm btn-circle ml-2"
                      aria-label="Remove access"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="modal-backdrop" onClick={closeDialog}>
          <button type="button">close</button>
        </div>
      </dialog>
    </>
  );
}
