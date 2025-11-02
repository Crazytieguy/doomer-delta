import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { computeSensitivity } from "@/lib/bayesianInference";

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
  const sensitivities = useMemo(() => {
    const sensitivityMap = computeSensitivity(nodes, targetNodeId);

    const results = Array.from(sensitivityMap.entries())
      .map(([nodeId, sensitivity]) => {
        const node = nodes.find((n) => n._id === nodeId);
        return {
          nodeId,
          nodeName: node?.title ?? "Unknown",
          sensitivity,
        };
      })
      .sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity));

    return results;
  }, [nodes, targetNodeId]);

  if (sensitivities.length === 0) {
    return (
      <div className="text-sm opacity-70">
        This node has no parent nodes, so its probability is independent and not
        affected by other nodes in the network.
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
                  {sensitivity >= 0 ? "+" : ""}
                  {sensitivity.toFixed(3)}
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
