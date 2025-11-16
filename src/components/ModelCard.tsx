import { Link } from "@tanstack/react-router";
import { GitFork } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";

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
}

export function ModelCard({
  modelId,
  name,
  description,
  ownerName,
  creationTime,
  uniqueForkers,
  badge,
}: ModelCardProps) {
  return (
    <Link
      to="/models/$modelId"
      params={{ modelId }}
      className="card border-2 border-base-300 bg-gradient-to-br from-base-200 to-base-300/20 hover:shadow-md transition-all duration-300"
    >
      <div className="card-body">
        <div className="flex items-start justify-between gap-2">
          <h3 className="card-title flex-1">{name}</h3>
          {badge && (
            <span
              className={`badge ${badge.variant === "primary" ? "badge-primary" : "badge-accent"}`}
            >
              {badge.text}
            </span>
          )}
        </div>
        {description ? (
          <p className="text-sm opacity-70">{description}</p>
        ) : (
          <p className="text-sm opacity-50 italic">No description</p>
        )}
        <div className="flex items-center justify-between gap-2 text-sm opacity-60 mt-2 pt-2 border-t border-base-300">
          <div className="flex items-center gap-2">
            <span>by {ownerName}</span>
            <span>•</span>
            <span>{new Date(creationTime).toLocaleDateString()}</span>
          </div>
          {(uniqueForkers ?? 0) > 0 && (
            <span className="text-secondary flex items-center gap-1">
              <GitFork size={14} strokeWidth={2.5} />
              <span className="font-semibold">{uniqueForkers}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
