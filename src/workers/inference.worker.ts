import type { Id } from "../../convex/_generated/dataModel";
import {
  workerRequestSchema,
  type WorkerNode,
} from "../types/workerMessages";

interface Factor {
  scope: Id<"nodes">[];
  table: Map<string, number>;
}

function serializeAssignment(assignment: Map<Id<"nodes">, boolean>): string {
  const sorted = Array.from(assignment.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  return sorted.map(([id, val]) => `${id}:${val ? "T" : "F"}`).join(",");
}

function enumerateBinaryAssignments(
  vars: Id<"nodes">[],
): Map<Id<"nodes">, boolean>[] {
  if (vars.length === 0) return [new Map()];

  if (vars.length > 20) {
    throw new Error(
      `Factor scope too large: ${vars.length} variables. Variable elimination requires exponential memory.`,
    );
  }

  const results: Map<Id<"nodes">, boolean>[] = [];
  const n = vars.length;
  const total = Math.pow(2, n);

  for (let i = 0; i < total; i++) {
    const assignment = new Map<Id<"nodes">, boolean>();
    let remaining = i;
    for (let j = 0; j < n; j++) {
      assignment.set(vars[j], Boolean(remaining % 2));
      remaining = Math.floor(remaining / 2);
    }
    results.push(assignment);
  }

  return results;
}

function projectAssignment(
  assignment: Map<Id<"nodes">, boolean>,
  scope: Id<"nodes">[],
): Map<Id<"nodes">, boolean> {
  const projected = new Map<Id<"nodes">, boolean>();
  for (const v of scope) {
    const val = assignment.get(v);
    if (val !== undefined) {
      projected.set(v, val);
    }
  }
  return projected;
}

function unionScopes(
  scope1: Id<"nodes">[],
  scope2: Id<"nodes">[],
): Id<"nodes">[] {
  const set = new Set([...scope1, ...scope2]);
  return Array.from(set);
}

function lookupConditional(
  node: WorkerNode,
  parentAssignment: Map<Id<"nodes">, boolean>,
): number {
  let bestEntry = null;
  let bestSpecificity = -1;

  for (const entry of node.cptEntries) {
    let matches = true;
    let specificity = 0;

    for (const [parentId, requiredState] of Object.entries(
      entry.parentStates,
    )) {
      if (requiredState !== null) {
        specificity++;
        const actualState = parentAssignment.get(parentId as Id<"nodes">);
        if (actualState !== requiredState) {
          matches = false;
          break;
        }
      }
    }

    if (matches && specificity > bestSpecificity) {
      bestEntry = entry;
      bestSpecificity = specificity;
    }
  }

  if (!bestEntry) {
    throw new Error(
      `Invalid CPT for node ${node._id}: no matching entry found for parent configuration. CPT must include a wildcard entry to cover all cases.`,
    );
  }

  return bestEntry.probability;
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

function buildSingleNodeFactor(node: WorkerNode): Factor {
  const parentIds = getParentIds(node);
  const scope = [...parentIds, node._id];
  const table = new Map<string, number>();

  const assignments = enumerateBinaryAssignments(scope);

  for (const assignment of assignments) {
    const nodeValue = assignment.get(node._id)!;
    const parentAssignment = projectAssignment(assignment, parentIds);

    const probTrue = lookupConditional(node, parentAssignment);

    const prob = nodeValue ? probTrue : 1 - probTrue;
    table.set(serializeAssignment(assignment), prob);
  }

  return { scope, table };
}

function buildInterventionFactor(
  nodeId: Id<"nodes">,
  probability: number,
): Factor {
  const scope = [nodeId];
  const table = new Map<string, number>();

  table.set(serializeAssignment(new Map([[nodeId, true]])), probability);
  table.set(serializeAssignment(new Map([[nodeId, false]])), 1 - probability);

  return { scope, table };
}

function buildInitialFactors(nodes: WorkerNode[]): Factor[] {
  const factors: Factor[] = [];

  for (const node of nodes) {
    factors.push(buildSingleNodeFactor(node));
  }

  return factors;
}

function factorProduct(f1: Factor, f2: Factor): Factor {
  const newScope = unionScopes(f1.scope, f2.scope);
  const table = new Map<string, number>();

  const assignments = enumerateBinaryAssignments(newScope);

  for (const assignment of assignments) {
    const proj1 = projectAssignment(assignment, f1.scope);
    const proj2 = projectAssignment(assignment, f2.scope);

    const key1 = serializeAssignment(proj1);
    const key2 = serializeAssignment(proj2);
    const keyNew = serializeAssignment(assignment);

    const val1 = f1.table.get(key1) ?? 0;
    const val2 = f2.table.get(key2) ?? 0;

    table.set(keyNew, val1 * val2);
  }

  return { scope: newScope, table };
}

function sumOut(factor: Factor, variable: Id<"nodes">): Factor {
  const newScope = factor.scope.filter((v) => v !== variable);
  const table = new Map<string, number>();

  const assignments = enumerateBinaryAssignments(newScope);

  for (const assignment of assignments) {
    const key = serializeAssignment(assignment);
    let sum = 0;

    for (const value of [true, false]) {
      const fullAssignment = new Map(assignment);
      fullAssignment.set(variable, value);
      const fullKey = serializeAssignment(fullAssignment);
      sum += factor.table.get(fullKey) ?? 0;
    }

    table.set(key, sum);
  }

  return { scope: newScope, table };
}

function eliminateAllExcept(
  factors: Factor[],
  queryVars: Id<"nodes">[],
): Factor {
  const allVars = new Set<Id<"nodes">>();
  for (const factor of factors) {
    for (const v of factor.scope) {
      allVars.add(v);
    }
  }

  const querySet = new Set(queryVars);
  const eliminationOrder: Id<"nodes">[] = [];

  for (const v of allVars) {
    if (!querySet.has(v)) {
      eliminationOrder.push(v);
    }
  }

  let currentFactors = [...factors];

  for (const variable of eliminationOrder) {
    const relevant: Factor[] = [];
    const irrelevant: Factor[] = [];

    for (const f of currentFactors) {
      if (f.scope.includes(variable)) {
        relevant.push(f);
      } else {
        irrelevant.push(f);
      }
    }

    if (relevant.length === 0) continue;

    let product = relevant[0];
    for (let i = 1; i < relevant.length; i++) {
      product = factorProduct(product, relevant[i]);
    }

    const marginalized = sumOut(product, variable);

    currentFactors = [...irrelevant, marginalized];
  }

  if (currentFactors.length === 0) {
    return { scope: [], table: new Map() };
  }

  let result = currentFactors[0];
  for (let i = 1; i < currentFactors.length; i++) {
    result = factorProduct(result, currentFactors[i]);
  }

  return result;
}

function deserializeAssignment(key: string): Map<Id<"nodes">, boolean> {
  const assignment = new Map<Id<"nodes">, boolean>();
  if (key === "") return assignment;

  const pairs = key.split(",");
  for (const pair of pairs) {
    const [varId, value] = pair.split(":");
    assignment.set(varId as Id<"nodes">, value === "T");
  }
  return assignment;
}

function computeAllMarginalsOptimized(
  factors: Factor[],
): Map<Id<"nodes">, number> {
  const probabilities = new Map<Id<"nodes">, number>();

  const allVars = new Set<Id<"nodes">>();
  for (const factor of factors) {
    for (const v of factor.scope) {
      allVars.add(v);
    }
  }

  const eliminationOrder = Array.from(allVars);
  let currentFactors = [...factors];

  for (const variable of eliminationOrder) {
    const relevant: Factor[] = [];
    const irrelevant: Factor[] = [];

    for (const f of currentFactors) {
      if (f.scope.includes(variable)) {
        relevant.push(f);
      } else {
        irrelevant.push(f);
      }
    }

    if (relevant.length === 0) continue;

    let product = relevant[0];
    for (let i = 1; i < relevant.length; i++) {
      product = factorProduct(product, relevant[i]);
    }

    const marginalFactor = sumOut(product, variable);

    let probTrue = 0;
    let probFalse = 0;

    for (const [key, value] of product.table.entries()) {
      const assignment = deserializeAssignment(key);
      if (assignment.get(variable) === true) {
        probTrue += value;
      } else if (assignment.get(variable) === false) {
        probFalse += value;
      }
    }

    const total = probTrue + probFalse;
    const normalized = total > Number.EPSILON ? probTrue / total : 0.5;
    probabilities.set(variable, normalized);

    currentFactors = [...irrelevant, marginalFactor];
  }

  return probabilities;
}

function computeMarginalProbabilities(
  nodes: WorkerNode[],
  options?: {
    targetNodeId?: Id<"nodes">;
    prebuiltFactors?: Factor[];
  },
): Map<Id<"nodes">, number> {
  if (nodes.length === 0) return new Map();

  const factors = options?.prebuiltFactors ?? buildInitialFactors(nodes);

  if (!options?.targetNodeId) {
    return computeAllMarginalsOptimized(factors);
  }

  const probabilities = new Map<Id<"nodes">, number>();
  const nodesToCompute = nodes.filter((n) => n._id === options.targetNodeId);

  for (const node of nodesToCompute) {
    const result = eliminateAllExcept(factors, [node._id]);

    const trueKey = serializeAssignment(new Map([[node._id, true]]));
    const falseKey = serializeAssignment(new Map([[node._id, false]]));
    const probTrue = result.table.get(trueKey) ?? 0;
    const probFalse = result.table.get(falseKey) ?? 0;
    const total = probTrue + probFalse;

    const normalized = total > Number.EPSILON ? probTrue / total : 0.5;

    probabilities.set(node._id, normalized);
  }

  return probabilities;
}

function getAncestors(
  nodeId: Id<"nodes">,
  nodes: WorkerNode[],
): Set<Id<"nodes">> {
  const ancestors = new Set<Id<"nodes">>();
  const visited = new Set<Id<"nodes">>();
  const queue: Id<"nodes">[] = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentNode = nodes.find((n) => n._id === currentId);
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

  const nodeMap = new Map(nodes.map((n) => [n._id, n]));
  const baselineFactors = buildInitialFactors(nodes);

  const ancestorArray = Array.from(ancestors);
  const total = ancestorArray.length;

  for (let i = 0; i < ancestorArray.length; i++) {
    const ancestorId = ancestorArray[i];
    const ancestorNode = nodeMap.get(ancestorId);
    if (!ancestorNode) continue;

    const ancestorIndex = nodes.findIndex((n) => n._id === ancestorId);
    if (ancestorIndex === -1) continue;

    const factorsTrue = [...baselineFactors];
    factorsTrue[ancestorIndex] = buildInterventionFactor(ancestorId, 1.0);

    const probsTrue = computeMarginalProbabilities(nodes, {
      targetNodeId,
      prebuiltFactors: factorsTrue,
    });

    const factorsFalse = [...baselineFactors];
    factorsFalse[ancestorIndex] = buildInterventionFactor(ancestorId, 0.0);

    const probsFalse = computeMarginalProbabilities(nodes, {
      targetNodeId,
      prebuiltFactors: factorsFalse,
    });

    const targetTrue = probsTrue.get(targetNodeId) ?? 0.5;
    const targetFalse = probsFalse.get(targetNodeId) ?? 0.5;

    const sensitivity = targetTrue - targetFalse;

    onProgress(ancestorId, sensitivity, i + 1, total);
  }
}

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
