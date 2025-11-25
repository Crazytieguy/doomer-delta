import { useEffect, useMemo, useRef } from "react";
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
  interventionNodes: Set<Id<"nodes">>;
}

export function SensitivityPanel({
  nodes,
  targetNodeId,
  interventionNodes,
}: SensitivityPanelProps) {
  const { computeMarginals, getCachedMarginals, marginalsState } =
    useInferenceWorker();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const probabilisticFingerprint = useMemo(
    () => computeProbabilisticFingerprint(nodes),
    [nodes],
  );

  const ancestors = useMemo(() => {
    const ancestorSet = new Set<Id<"nodes">>();
    const visited = new Set<Id<"nodes">>();
    const queue: Id<"nodes">[] = [targetNodeId];
    visited.add(targetNodeId);

    const parentMap = new Map<Id<"nodes">, Set<Id<"nodes">>>();
    for (const node of nodes) {
      const parents = new Set<Id<"nodes">>();
      for (const entry of node.cptEntries) {
        for (const parentId of Object.keys(entry.parentStates)) {
          parents.add(parentId as Id<"nodes">);
        }
      }
      parentMap.set(node._id, parents);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const parents = parentMap.get(current) || new Set();

      for (const parentId of parents) {
        if (!visited.has(parentId)) {
          ancestorSet.add(parentId);
          visited.add(parentId);
          queue.push(parentId);
        }
      }
    }

    return ancestorSet;
  }, [nodes, targetNodeId]);

  const relevantInterventionNodes = useMemo(() => {
    return Array.from(interventionNodes).filter((nodeId) =>
      ancestors.has(nodeId),
    );
  }, [interventionNodes, ancestors]);

  const inFlightRef = useRef(new Set<Id<"nodes">>());

  useEffect(() => {
    for (const interventionNodeId of relevantInterventionNodes) {
      const trueMarginals = getCachedMarginals(nodesRef.current, interventionNodeId, true);
      const falseMarginals = getCachedMarginals(nodesRef.current, interventionNodeId, false);

      // If cached, clear in-flight flag and skip
      if (trueMarginals && falseMarginals) {
        inFlightRef.current.delete(interventionNodeId);
        continue;
      }

      // Skip if already computing
      if (inFlightRef.current.has(interventionNodeId)) continue;

      // Mark as in-flight and compute
      inFlightRef.current.add(interventionNodeId);
      computeMarginals(nodesRef.current, interventionNodeId);
    }

    // Clean up in-flight tracking for nodes no longer relevant
    for (const nodeId of Array.from(inFlightRef.current)) {
      if (!relevantInterventionNodes.includes(nodeId)) {
        inFlightRef.current.delete(nodeId);
      }
    }
  }, [
    probabilisticFingerprint,
    relevantInterventionNodes,
    computeMarginals,
    getCachedMarginals,
    marginalsState, // Re-check when any marginals change
  ]);

  const { sensitivities, loadingNodes } = useMemo(() => {
    const results: Array<{
      nodeId: Id<"nodes">;
      nodeName: string;
      sensitivity: number;
    }> = [];
    const loading: Id<"nodes">[] = [];

    for (const interventionNodeId of relevantInterventionNodes) {
      const trueMarginals = getCachedMarginals(nodes, interventionNodeId, true);
      const falseMarginals = getCachedMarginals(
        nodes,
        interventionNodeId,
        false,
      );

      if (trueMarginals && falseMarginals) {
        const probTrue = trueMarginals.get(targetNodeId) ?? 0;
        const probFalse = falseMarginals.get(targetNodeId) ?? 0;
        const sensitivity = probTrue - probFalse;

        const node = nodes.find((n) => n._id === interventionNodeId);
        results.push({
          nodeId: interventionNodeId,
          nodeName: node?.title ?? "Unknown",
          sensitivity,
        });
      } else {
        loading.push(interventionNodeId);
      }
    }

    return {
      sensitivities: results.sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity)),
      loadingNodes: loading,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marginalsState triggers re-render when cache updates
  }, [relevantInterventionNodes, getCachedMarginals, nodes, targetNodeId, marginalsState]);

  if (marginalsState.error) {
    return (
      <div className="text-sm text-error">Error: {marginalsState.error}</div>
    );
  }

  if (relevantInterventionNodes.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 opacity-75" />
          <h4 className="font-semibold text-sm">Sensitivity Analysis</h4>
        </div>
        <div className="text-sm opacity-70">
          No intervention nodes selected that affect this node.{" "}
          <kbd className="kbd kbd-xs">Ctrl</kbd>/<kbd className="kbd kbd-xs">Cmd</kbd> + click
          nodes in the graph to mark them as intervention nodes and see their
          influence.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-4 h-4 opacity-75" />
        <h4 className="font-semibold text-sm">Sensitivity Analysis</h4>
        {loadingNodes.length > 0 && (
          <Loader2 className="w-3 h-3 animate-spin opacity-60" />
        )}
      </div>
      <p className="text-xs opacity-60 mb-4">
        How each intervention node influences this node's probability.{" "}
        <kbd className="kbd kbd-xs">Ctrl</kbd>/<kbd className="kbd kbd-xs">Cmd</kbd> + click
        to toggle interventions.
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
                  {formatProbabilityAsPercentage(Math.abs(sensitivity)).replace(
                    /^/,
                    sensitivity >= 0 ? "+" : "-",
                  )}
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
        {loadingNodes.map((nodeId) => {
          const node = nodes.find((n) => n._id === nodeId);
          const nodeName = node?.title ?? "Unknown";
          return (
            <div key={nodeId} className="space-y-1.5 opacity-50">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium">{nodeName}</span>
                <Loader2 className="w-3 h-3 animate-spin" />
              </div>
              <div className="w-full bg-base-300/40 rounded-full h-2 overflow-hidden">
                <div className="bg-primary/40 h-2 rounded-full animate-pulse w-full" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
