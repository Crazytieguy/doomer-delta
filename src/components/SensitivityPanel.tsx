import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, Loader2 } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { useInferenceWorker } from "@/hooks/useInferenceWorker";
import { computeProbabilisticFingerprint } from "@/lib/probabilisticFingerprint";
import { formatProbabilityAsPercentage } from "@/lib/formatProbability";

interface Node {
  _id: Id<"nodes">;
  _creationTime: number;
  modelId: Id<"models">;
  title: string;
  description?: string;
  x: number;
  y: number;
  cptEntries: Array<{
    parentStates: Record<string, boolean | null>;
    probability: number;
  }>;
}

interface SensitivityPanelProps {
  nodes: Node[];
  targetNodeId: Id<"nodes">;
}

export function SensitivityPanel({
  nodes,
  targetNodeId,
}: SensitivityPanelProps) {
  const { computeSensitivity, sensitivityState } = useInferenceWorker();
  const nodesRef = useRef(nodes);
  const [hasInitialized, setHasInitialized] = useState(false);
  nodesRef.current = nodes;

  const probabilisticFingerprint = useMemo(
    () => computeProbabilisticFingerprint(nodes),
    [nodes]
  );

  useEffect(() => {
    computeSensitivity(nodesRef.current, targetNodeId);
    setHasInitialized(true);
  }, [probabilisticFingerprint, targetNodeId, computeSensitivity]);

  const sensitivities = useMemo(() => {
    return Array.from(sensitivityState.results.entries())
      .map(([nodeId, sensitivity]) => {
        const node = nodes.find((n) => n._id === nodeId);
        return {
          nodeId,
          nodeName: node?.title ?? "Unknown",
          sensitivity,
        };
      })
      .sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity));
  }, [sensitivityState.results, nodes]);

  if (sensitivityState.error) {
    return (
      <div className="text-sm text-error">
        Error: {sensitivityState.error}
      </div>
    );
  }

  if (!hasInitialized) {
    return null;
  }

  if (!sensitivityState.isLoading && sensitivities.length === 0) {
    return (
      <div className="text-sm opacity-70">
        This node has no parent nodes, so its probability is independent and not
        affected by other nodes in the network.
      </div>
    );
  }

  if (sensitivityState.isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 opacity-75" />
          <h4 className="font-semibold text-sm">Sensitivity Analysis</h4>
          <Loader2 className="w-3 h-3 animate-spin opacity-60" />
        </div>
        <p className="text-xs opacity-60 mb-4">
          How each parent influences this node's probability
        </p>
        <div className="mb-4">
          <div className="w-full bg-base-300/40 rounded-full h-2 overflow-hidden">
            <div className="bg-primary h-2 rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs opacity-50 mt-2 text-center">
            Computing sensitivity analysis...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-4 h-4 opacity-75" />
        <h4 className="font-semibold text-sm">Sensitivity Analysis</h4>
      </div>
      <p className="text-xs opacity-60 mb-4">
        How each parent influences this node's probability
      </p>

      <div className="space-y-3">
        {sensitivities.map(({ nodeId, nodeName, sensitivity }) => {
          const isPositive = sensitivity >= 0;
          const absValue = Math.abs(sensitivity);
          return (
            <div key={nodeId} className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium">{nodeName}</span>
                <span
                  className={`text-xs font-semibold tabular-nums ${isPositive ? "text-success" : "text-error"}`}
                >
                  {formatProbabilityAsPercentage(Math.abs(sensitivity))
                    .replace(/^/, sensitivity >= 0 ? "+" : "-")}
                </span>
              </div>
              <div className="w-full bg-base-300/40 rounded-full h-2">
                <div
                  className={`${isPositive ? "bg-success" : "bg-error"} h-2 rounded-full transition-all`}
                  style={{ width: `${Math.abs(absValue) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
