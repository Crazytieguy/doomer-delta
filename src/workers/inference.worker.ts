import type { Id } from "../../convex/_generated/dataModel";
import {
  workerRequestSchema,
  type WorkerNode,
} from "../types/workerMessages";

interface Factor {
  scope: Id<"nodes">[];
  scopeToIndex: Map<Id<"nodes">, number>;
  table: Float64Array;
}

const factorCache = new Map<string, Factor>();

function assignmentToBits(
  assignment: Map<Id<"nodes">, boolean>,
  scopeToIndex: Map<Id<"nodes">, number>,
): number {
  if (scopeToIndex.size >= 31) {
    throw new Error(
      `Factor scope too large: ${scopeToIndex.size} variables (max 31 for bit-packing). ` +
      `This network is too densely connected for exact inference.`,
    );
  }

  let bits = 0;
  for (const [id, value] of assignment) {
    const index = scopeToIndex.get(id);
    if (index !== undefined && value) {
      bits |= 1 << index;
    }
  }
  return bits;
}

function bitsToAssignment(
  bits: number,
  scope: Id<"nodes">[],
): Map<Id<"nodes">, boolean> {
  const assignment = new Map<Id<"nodes">, boolean>();
  for (let i = 0; i < scope.length; i++) {
    assignment.set(scope[i], Boolean(bits & (1 << i)));
  }
  return assignment;
}

function createFactorCacheKey(node: WorkerNode): string {
  const sortedEntries = [...node.cptEntries].sort((a, b) => {
    const aKeys = Object.keys(a.parentStates).sort().join(",");
    const bKeys = Object.keys(b.parentStates).sort().join(",");
    if (aKeys !== bKeys) return aKeys.localeCompare(bKeys);
    return a.probability - b.probability;
  });
  return `${node._id}:${JSON.stringify(sortedEntries)}`;
}

interface CPTIndexEntry {
  pattern: number;
  mask: number;
  specificity: number;
  probability: number;
}

interface CPTIndex {
  parentIds: Id<"nodes">[];
  parentToIndex: Map<Id<"nodes">, number>;
  entries: CPTIndexEntry[];
  wildcardProbability: number;
}

const cptIndexCache = new Map<string, CPTIndex>();

function buildCPTIndex(node: WorkerNode): CPTIndex {
  const cacheKey = createFactorCacheKey(node);
  const cached = cptIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const parentIds = getParentIds(node);
  const parentToIndex = new Map(parentIds.map((id, idx) => [id, idx]));
  const entries: CPTIndexEntry[] = [];
  let wildcardProbability = 0.5;

  for (const entry of node.cptEntries) {
    let pattern = 0;
    let mask = 0;
    let specificity = 0;

    for (const [parentId, state] of Object.entries(entry.parentStates)) {
      if (state !== null) {
        const bitPos = parentToIndex.get(parentId as Id<"nodes">);
        if (bitPos !== undefined) {
          mask |= 1 << bitPos;
          if (state) {
            pattern |= 1 << bitPos;
          }
          specificity++;
        }
      }
    }

    if (specificity === 0) {
      wildcardProbability = entry.probability;
    } else {
      entries.push({
        pattern,
        mask,
        specificity,
        probability: entry.probability,
      });
    }
  }

  entries.sort((a, b) => b.specificity - a.specificity);

  const index = {
    parentIds,
    parentToIndex,
    entries,
    wildcardProbability,
  };

  cptIndexCache.set(cacheKey, index);
  return index;
}

function lookupConditionalIndexed(
  cptIndex: CPTIndex,
  parentAssignment: Map<Id<"nodes">, boolean>,
): number {
  let assignmentBits = 0;
  for (const [parentId, value] of parentAssignment) {
    const bitPos = cptIndex.parentToIndex.get(parentId);
    if (bitPos !== undefined && value) {
      assignmentBits |= 1 << bitPos;
    }
  }

  for (const entry of cptIndex.entries) {
    if ((assignmentBits & entry.mask) === entry.pattern) {
      return entry.probability;
    }
  }

  return cptIndex.wildcardProbability;
}

function enumerateBinaryAssignments(
  vars: Id<"nodes">[],
): Map<Id<"nodes">, boolean>[] {
  if (vars.length === 0) return [new Map()];

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
  const cacheKey = createFactorCacheKey(node);
  const cached = factorCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const parentIds = getParentIds(node);
  const scope = [...parentIds, node._id];

  if (scope.length >= 31) {
    throw new Error(
      `Cannot build factor for node ${node._id}: scope has ${scope.length} variables (max 31). ` +
      `Node has too many parents for exact inference with bit-packing.`,
    );
  }

  const scopeToIndex = new Map(scope.map((id, idx) => [id, idx]));
  const tableSize = Math.pow(2, scope.length);
  const table = new Float64Array(tableSize);

  const cptIndex = buildCPTIndex(node);
  const assignments = enumerateBinaryAssignments(scope);

  for (const assignment of assignments) {
    const nodeValue = assignment.get(node._id)!;
    const parentAssignment = projectAssignment(assignment, parentIds);

    const probTrue = lookupConditionalIndexed(cptIndex, parentAssignment);

    const prob = nodeValue ? probTrue : 1 - probTrue;
    const bits = assignmentToBits(assignment, scopeToIndex);
    table[bits] = prob;
  }

  const factor = { scope, scopeToIndex, table };
  factorCache.set(cacheKey, factor);
  return factor;
}

function buildInterventionFactor(
  nodeId: Id<"nodes">,
  probability: number,
): Factor {
  const scope = [nodeId];
  const scopeToIndex = new Map([[nodeId, 0]]);
  const table = new Float64Array(2);

  table[0] = 1 - probability;
  table[1] = probability;

  return { scope, scopeToIndex, table };
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

  if (newScope.length >= 31) {
    throw new Error(
      `Factor product scope too large: ${newScope.length} variables (max 31). ` +
      `This network creates intermediate factors that are too large for exact inference. ` +
      `Try reducing network connectivity or switching to approximate inference.`,
    );
  }

  const scopeToIndex = new Map(newScope.map((id, idx) => [id, idx]));
  const tableSize = Math.pow(2, newScope.length);
  const table = new Float64Array(tableSize);

  for (let bits = 0; bits < tableSize; bits++) {
    const assignment = bitsToAssignment(bits, newScope);

    const bits1 = assignmentToBits(assignment, f1.scopeToIndex);
    const bits2 = assignmentToBits(assignment, f2.scopeToIndex);

    const val1 = f1.table[bits1] ?? 0;
    const val2 = f2.table[bits2] ?? 0;

    table[bits] = val1 * val2;
  }

  return { scope: newScope, scopeToIndex, table };
}

function sumOut(factor: Factor, variable: Id<"nodes">): Factor {
  const newScope = factor.scope.filter((v) => v !== variable);
  const scopeToIndex = new Map(newScope.map((id, idx) => [id, idx]));
  const tableSize = Math.pow(2, newScope.length);
  const table = new Float64Array(tableSize);

  const varIndex = factor.scopeToIndex.get(variable);
  if (varIndex === undefined) {
    return { scope: newScope, scopeToIndex, table };
  }

  for (let bits = 0; bits < tableSize; bits++) {
    const assignment = bitsToAssignment(bits, newScope);

    let sum = 0;
    for (const value of [true, false]) {
      const fullAssignment = new Map(assignment);
      fullAssignment.set(variable, value);
      const fullBits = assignmentToBits(fullAssignment, factor.scopeToIndex);
      sum += factor.table[fullBits] ?? 0;
    }

    table[bits] = sum;
  }

  return { scope: newScope, scopeToIndex, table };
}

function computeEliminationOrder(
  factors: Factor[],
  queryVars: Set<Id<"nodes">>,
): Id<"nodes">[] {
  const neighbors = new Map<Id<"nodes">, Set<Id<"nodes">>>();
  const allVars = new Set<Id<"nodes">>();

  for (const factor of factors) {
    for (const v of factor.scope) {
      allVars.add(v);
      if (!neighbors.has(v)) {
        neighbors.set(v, new Set());
      }
    }

    for (const v1 of factor.scope) {
      for (const v2 of factor.scope) {
        if (v1 !== v2) {
          neighbors.get(v1)!.add(v2);
        }
      }
    }
  }

  const eliminationOrder: Id<"nodes">[] = [];
  const eliminated = new Set<Id<"nodes">>();

  const toEliminate = new Set<Id<"nodes">>();
  for (const v of allVars) {
    if (!queryVars.has(v)) {
      toEliminate.add(v);
    }
  }

  while (toEliminate.size > 0) {
    let bestVar: Id<"nodes"> | null = null;
    let bestFill = Infinity;
    let bestDegree = Infinity;
    let bestActiveNeighbors: Id<"nodes">[] = [];

    for (const v of toEliminate) {
      const neighborSet = neighbors.get(v)!;
      const activeNeighbors = Array.from(neighborSet).filter(
        (n) => !eliminated.has(n),
      );

      let fill = 0;
      for (let i = 0; i < activeNeighbors.length; i++) {
        for (let j = i + 1; j < activeNeighbors.length; j++) {
          const n1 = activeNeighbors[i];
          const n2 = activeNeighbors[j];
          if (!neighbors.get(n1)?.has(n2)) {
            fill++;
          }
        }
      }

      if (
        fill < bestFill ||
        (fill === bestFill && activeNeighbors.length < bestDegree)
      ) {
        bestVar = v;
        bestFill = fill;
        bestDegree = activeNeighbors.length;
        bestActiveNeighbors = activeNeighbors;
      }
    }

    if (bestVar === null) break;

    eliminationOrder.push(bestVar);
    eliminated.add(bestVar);
    toEliminate.delete(bestVar);

    for (let i = 0; i < bestActiveNeighbors.length; i++) {
      for (let j = i + 1; j < bestActiveNeighbors.length; j++) {
        const n1: Id<"nodes"> = bestActiveNeighbors[i];
        const n2: Id<"nodes"> = bestActiveNeighbors[j];
        neighbors.get(n1)!.add(n2);
        neighbors.get(n2)!.add(n1);
      }
    }
  }

  return eliminationOrder;
}

function eliminateAllExcept(
  factors: Factor[],
  queryVars: Id<"nodes">[],
): Factor {
  const querySet = new Set(queryVars);
  const eliminationOrder = computeEliminationOrder(factors, querySet);

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
    return { scope: [], scopeToIndex: new Map(), table: new Float64Array(0) };
  }

  let result = currentFactors[0];
  for (let i = 1; i < currentFactors.length; i++) {
    result = factorProduct(result, currentFactors[i]);
  }

  return result;
}

function computeAllMarginalsOptimized(
  factors: Factor[],
): Map<Id<"nodes">, number> {
  const probabilities = new Map<Id<"nodes">, number>();

  const eliminationOrder = computeEliminationOrder(factors, new Set());
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

    const nodeToFactors = new Map<Id<"nodes">, Factor[]>();
    for (const f of currentFactors) {
      for (const v of f.scope) {
        if (!nodeToFactors.has(v)) {
          nodeToFactors.set(v, []);
        }
        nodeToFactors.get(v)!.push(f);
      }
    }

    const visited = new Set<Factor>(relevant);
    const queue: Factor[] = [...relevant];

    let head = 0;
    while (head < queue.length) {
      const factor = queue[head++];
      for (const varId of factor.scope) {
        const neighbors = nodeToFactors.get(varId) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    const neededForMarginal = Array.from(visited);

    let jointForMarginal = neededForMarginal[0];
    for (let i = 1; i < neededForMarginal.length; i++) {
      jointForMarginal = factorProduct(jointForMarginal, neededForMarginal[i]);
    }

    let probTrue = 0;
    let probFalse = 0;

    const tableSize = jointForMarginal.table.length;
    for (let bits = 0; bits < tableSize; bits++) {
      const value = jointForMarginal.table[bits];
      const assignment = bitsToAssignment(bits, jointForMarginal.scope);
      if (assignment.get(variable) === true) {
        probTrue += value;
      } else if (assignment.get(variable) === false) {
        probFalse += value;
      }
    }

    const total = probTrue + probFalse;
    const normalized = total > Number.EPSILON ? probTrue / total : 0.5;
    probabilities.set(variable, normalized);

    let product = relevant[0];
    for (let i = 1; i < relevant.length; i++) {
      product = factorProduct(product, relevant[i]);
    }

    const marginalFactor = sumOut(product, variable);

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

    const trueAssignment = new Map([[node._id, true]]);
    const falseAssignment = new Map([[node._id, false]]);
    const trueBits = assignmentToBits(trueAssignment, result.scopeToIndex);
    const falseBits = assignmentToBits(falseAssignment, result.scopeToIndex);
    const probTrue = result.table[trueBits] ?? 0;
    const probFalse = result.table[falseBits] ?? 0;
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

export { buildInitialFactors, computeMarginalProbabilities };

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
