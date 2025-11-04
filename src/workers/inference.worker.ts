import type { Id } from "../../convex/_generated/dataModel";
import {
  workerRequestSchema,
  type WorkerNode,
} from "../types/workerMessages";

// 100K samples provides ~0.16% standard error for p=0.5, adequate for 2 decimal place precision
const DEFAULT_NUM_SAMPLES = 100000;
// 50K samples for sensitivity provides ~0.22% error per query, 2x speedup with minimal accuracy loss
const SENSITIVITY_NUM_SAMPLES = 50000;

interface CPTIndex {
  parentIds: Id<"nodes">[];
  parentToIndex: Map<Id<"nodes">, number>;
  entries: Array<{
    pattern: bigint;
    mask: bigint;
    specificity: number;
    probability: number;
  }>;
  wildcardProbability: number | undefined;
}

function getParentIds(node: WorkerNode): Id<"nodes">[] {
  const parentIds = new Set<Id<"nodes">>();
  for (const entry of node.cptEntries) {
    for (const parentId of Object.keys(entry.parentStates)) {
      parentIds.add(parentId as Id<"nodes">);
    }
  }
  return Array.from(parentIds);
}

function buildCPTIndex(node: WorkerNode): CPTIndex {
  const parentIds = getParentIds(node);
  const parentToIndex = new Map(parentIds.map((id, idx) => [id, idx]));

  const entries: Array<{
    pattern: bigint;
    mask: bigint;
    specificity: number;
    probability: number;
  }> = [];
  let wildcardProbability: number | undefined = undefined;

  for (const entry of node.cptEntries) {
    let pattern = 0n;
    let mask = 0n;
    let specificity = 0;

    for (const [parentId, state] of Object.entries(entry.parentStates)) {
      if (state !== null) {
        const bitPos = parentToIndex.get(parentId as Id<"nodes">);
        if (bitPos !== undefined) {
          mask |= 1n << BigInt(bitPos);
          if (state) {
            pattern |= 1n << BigInt(bitPos);
          }
          specificity++;
        }
      }
    }

    if (specificity === 0) {
      wildcardProbability = entry.probability;
    } else {
      entries.push({ pattern, mask, specificity, probability: entry.probability });
    }
  }

  entries.sort((a, b) => b.specificity - a.specificity);

  return {
    parentIds,
    parentToIndex,
    entries,
    wildcardProbability,
  };
}

function lookupConditional(
  cptIndex: CPTIndex,
  parentAssignment: Map<Id<"nodes">, boolean>,
): number {
  let assignmentBits = 0n;
  for (const [parentId, value] of parentAssignment) {
    const bitPos = cptIndex.parentToIndex.get(parentId);
    if (bitPos !== undefined && value) {
      assignmentBits |= 1n << BigInt(bitPos);
    }
  }

  for (const entry of cptIndex.entries) {
    if ((assignmentBits & entry.mask) === entry.pattern) {
      return entry.probability;
    }
  }

  if (cptIndex.wildcardProbability === undefined) {
    throw new Error(
      `CPT lookup failed: no matching entry found and no wildcard probability defined`
    );
  }

  return cptIndex.wildcardProbability;
}

function topologicalSort(nodes: WorkerNode[]): Id<"nodes">[] {
  const nodeSet = new Set(nodes.map(n => n._id));
  const inDegree = new Map<Id<"nodes">, number>();
  const adjacency = new Map<Id<"nodes">, Id<"nodes">[]>();

  for (const node of nodes) {
    inDegree.set(node._id, 0);
    adjacency.set(node._id, []);
  }

  for (const node of nodes) {
    const parentIds = getParentIds(node);

    // Validate all parent nodes exist in the graph
    for (const parentId of parentIds) {
      if (!nodeSet.has(parentId)) {
        throw new Error(
          `Node ${node._id} references parent ${parentId} which is not in the node array`
        );
      }
    }

    inDegree.set(node._id, parentIds.length);

    for (const parentId of parentIds) {
      if (!adjacency.has(parentId)) {
        adjacency.set(parentId, []);
      }
      adjacency.get(parentId)!.push(node._id);
    }
  }

  const queue: Id<"nodes">[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sorted: Id<"nodes">[] = [];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const nodeId = queue[queueIndex++];
    sorted.push(nodeId);

    for (const childId of adjacency.get(nodeId) || []) {
      const newDegree = inDegree.get(childId)! - 1;
      inDegree.set(childId, newDegree);
      if (newDegree === 0) {
        queue.push(childId);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error("Graph has cycles - cannot perform topological sort");
  }

  return sorted;
}

function generateSample(
  nodeOrder: Id<"nodes">[],
  cptIndexMap: Map<Id<"nodes">, CPTIndex>,
  interventions: Map<Id<"nodes">, boolean>,
  sampleBuffer: Map<Id<"nodes">, boolean>,
  parentBuffer: Map<Id<"nodes">, boolean>,
): void {
  sampleBuffer.clear();

  for (const nodeId of nodeOrder) {
    if (interventions.has(nodeId)) {
      sampleBuffer.set(nodeId, interventions.get(nodeId)!);
    } else {
      const cptIndex = cptIndexMap.get(nodeId)!;
      parentBuffer.clear();

      for (const parentId of cptIndex.parentIds) {
        const parentValue = sampleBuffer.get(parentId);
        if (parentValue === undefined) {
          throw new Error(
            `Parent ${parentId} not sampled before child ${nodeId} - topological sort failed`
          );
        }
        parentBuffer.set(parentId, parentValue);
      }

      const probTrue = lookupConditional(cptIndex, parentBuffer);
      sampleBuffer.set(nodeId, Math.random() < probTrue);
    }
  }
}

function computeMarginalProbabilities(
  nodes: WorkerNode[],
  numSamples: number = DEFAULT_NUM_SAMPLES,
  interventions: Map<Id<"nodes">, boolean> = new Map(),
): Map<Id<"nodes">, number> {
  if (nodes.length === 0) return new Map();
  if (numSamples <= 0) throw new Error("numSamples must be positive");

  const nodeOrder = topologicalSort(nodes);

  // Precompute CPT indexes once
  const cptIndexMap = new Map<Id<"nodes">, CPTIndex>();
  for (const node of nodes) {
    cptIndexMap.set(node._id, buildCPTIndex(node));
  }

  const counts = new Map<Id<"nodes">, number>();
  for (const node of nodes) {
    counts.set(node._id, 0);
  }

  const sampleBuffer = new Map<Id<"nodes">, boolean>();
  const parentBuffer = new Map<Id<"nodes">, boolean>();

  for (let i = 0; i < numSamples; i++) {
    generateSample(nodeOrder, cptIndexMap, interventions, sampleBuffer, parentBuffer);
    for (const [nodeId, value] of sampleBuffer) {
      if (value) {
        counts.set(nodeId, counts.get(nodeId)! + 1);
      }
    }
  }

  const probabilities = new Map<Id<"nodes">, number>();
  for (const [nodeId, count] of counts) {
    probabilities.set(nodeId, count / numSamples);
  }

  return probabilities;
}

function getAncestors(
  nodeId: Id<"nodes">,
  nodes: WorkerNode[],
): Set<Id<"nodes">> {
  const nodeMap = new Map(nodes.map((n) => [n._id, n]));
  const ancestors = new Set<Id<"nodes">>();
  const visited = new Set<Id<"nodes">>();
  const queue: Id<"nodes">[] = [nodeId];

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const currentId = queue[queueIndex++];
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentNode = nodeMap.get(currentId);
    if (!currentNode) continue;

    const parentIds = getParentIds(currentNode);
    for (const parentId of parentIds) {
      if (parentId !== nodeId) {
        ancestors.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return ancestors;
}

function computeSensitivityIncremental(
  nodes: WorkerNode[],
  targetNodeId: Id<"nodes">,
  onProgress: (nodeId: Id<"nodes">, sensitivity: number, completed: number, total: number) => void,
): void {
  const ancestors = getAncestors(targetNodeId, nodes);

  if (ancestors.size === 0) {
    return;
  }

  const ancestorArray = Array.from(ancestors);
  const total = ancestorArray.length;

  for (let i = 0; i < ancestorArray.length; i++) {
    const ancestorId = ancestorArray[i];

    const probsTrue = computeMarginalProbabilities(
      nodes,
      SENSITIVITY_NUM_SAMPLES,
      new Map([[ancestorId, true]])
    );

    const probsFalse = computeMarginalProbabilities(
      nodes,
      SENSITIVITY_NUM_SAMPLES,
      new Map([[ancestorId, false]])
    );

    const targetTrue = probsTrue.get(targetNodeId) ?? 0.5;
    const targetFalse = probsFalse.get(targetNodeId) ?? 0.5;

    const sensitivity = targetTrue - targetFalse;

    onProgress(ancestorId, sensitivity, i + 1, total);
  }
}

export { computeMarginalProbabilities };

if (typeof self !== "undefined" && "onmessage" in self) {
  self.onmessage = (event: MessageEvent) => {
    try {
      const message = workerRequestSchema.parse(event.data);

      if (message.type === "COMPUTE_MARGINALS") {
        const probabilities = computeMarginalProbabilities(message.nodes);

        const result: Record<string, number> = {};
        for (const [nodeId, prob] of probabilities.entries()) {
          result[nodeId] = prob;
        }

        self.postMessage({
          type: "MARGINALS_RESULT",
          requestId: message.requestId,
          probabilities: result,
        });
      } else if (message.type === "COMPUTE_SENSITIVITY") {
        const sensitivities: Array<{ nodeId: Id<"nodes">; sensitivity: number }> = [];

        computeSensitivityIncremental(
          message.nodes,
          message.targetNodeId,
          (nodeId, sensitivity, completed, total) => {
            sensitivities.push({ nodeId, sensitivity });

            self.postMessage({
              type: "SENSITIVITY_PROGRESS",
              requestId: message.requestId,
              nodeId,
              sensitivity,
              completed,
              total,
            });
          }
        );

        self.postMessage({
          type: "SENSITIVITY_COMPLETE",
          requestId: message.requestId,
          sensitivities,
        });
      }
    } catch (error) {
      self.postMessage({
        type: "ERROR",
        requestId: event.data?.requestId || "unknown",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
