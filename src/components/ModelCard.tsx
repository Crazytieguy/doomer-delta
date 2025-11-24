import { Link } from "@tanstack/react-router";
import { GitFork, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import {
  DeleteModelDialog,
  type DeleteModelDialogRef,
} from "./DeleteModelDialog";

interface ModelCardProps {
  modelId: Id<"models">;
  name: string;
  description?: string;
  ownerName: string;
  creationTime: number;
  uniqueForkers?: number;
  badge?: {
    text: string;
    variant: "primary" | "accent";
  };
  isOwner?: boolean;
  onDeleted?: () => void;
}

export function ModelCard({
  modelId,
  name,
  description,
  ownerName,
  creationTime,
  uniqueForkers,
  badge,
  isOwner,
  onDeleted,
}: ModelCardProps) {
  const deleteDialogRef = useRef<DeleteModelDialogRef>(null);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteDialogRef.current?.openDialog();
  };

  return (
    <>
      <Link
        to="/models/$modelId"
        params={{ modelId }}
        className="card border-2 border-base-300 bg-gradient-to-br from-base-200 to-base-300/20 hover:shadow-md transition-all duration-300 relative"
      >
        <div className="card-body">
          <div className="flex items-start justify-between gap-2">
            <h3 className="card-title flex-1">{name}</h3>
            <div className="flex items-center gap-2">
              {badge && (
                <span
                  className={`badge ${badge.variant === "primary" ? "badge-primary" : "badge-accent"}`}
                >
                  {badge.text}
                </span>
              )}
              {isOwner && (
                <button
                  onClick={handleDeleteClick}
                  className="btn btn-ghost btn-xs btn-circle opacity-60 hover:opacity-100 hover:text-error"
                  aria-label="Delete model"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {description ? (
            <p className="text-sm opacity-70">{description}</p>
          ) : (
            <p className="text-sm opacity-50 italic">No description</p>
          )}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 text-sm opacity-60 mt-2 pt-2 border-t border-base-300">
            <span className="flex items-center gap-2 min-w-0">
              <span className="shrink-0">by</span>
              <span className="truncate">{ownerName}</span>
            </span>
            <span className="shrink-0">•</span>
            <span className="shrink-0">
              {new Date(creationTime).toLocaleDateString()}
            </span>
            {(uniqueForkers ?? 0) > 0 && (
              <span className="text-secondary flex items-center gap-1 sm:ml-auto">
                <GitFork size={14} strokeWidth={2.5} />
                <span className="font-semibold">{uniqueForkers}</span>
              </span>
            )}
          </div>
        </div>
      </Link>
      {isOwner && (
        <DeleteModelDialog
          ref={deleteDialogRef}
          modelId={modelId}
          modelName={name}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
