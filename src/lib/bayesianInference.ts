import { Doc, Id } from "../../convex/_generated/dataModel";

export type NodeWithCPT = Doc<"nodes">;

export interface InferenceResult {
  nodeId: Id<"nodes">;
  probability: number;
}

// Factor-based inference types
interface Factor {
  scope: Id<"nodes">[];
  table: Map<string, number>;
}

// Helper: serialize assignment to string key
function serializeAssignment(assignment: Map<Id<"nodes">, boolean>): string {
  const sorted = Array.from(assignment.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  return sorted.map(([id, val]) => `${id}:${val ? "T" : "F"}`).join(",");
}

// Helper: enumerate all binary assignments for a set of variables
function enumerateBinaryAssignments(
  vars: Id<"nodes">[],
): Map<Id<"nodes">, boolean>[] {
  if (vars.length === 0) return [new Map()];

  // Check for too many variables (avoid exponential explosion and bit-shift limits)
  if (vars.length > 20) {
    throw new Error(
      `Factor scope too large: ${vars.length} variables. Variable elimination requires exponential memory.`,
    );
  }

  const results: Map<Id<"nodes">, boolean>[] = [];
  const n = vars.length;
  const total = Math.pow(2, n);

  // Use arithmetic enumeration instead of bit shifts to avoid 32-bit limit
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

// Helper: project assignment to subset of variables
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

// Helper: union of two scopes
function unionScopes(
  scope1: Id<"nodes">[],
  scope2: Id<"nodes">[],
): Id<"nodes">[] {
  const set = new Set([...scope1, ...scope2]);
  return Array.from(set);
}

// Lookup conditional probability with most-specific match rule
function lookupConditional(
  node: NodeWithCPT,
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
    // No matching CPT entry found - CPT is incomplete
    throw new Error(
      `Invalid CPT for node ${node._id}: no matching entry found for parent configuration. CPT must include a wildcard entry to cover all cases.`,
    );
  }

  return bestEntry.probability;
}

// Build a single factor for a node with a given CPT
function buildSingleNodeFactor(node: NodeWithCPT): Factor {
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

// Build a deterministic intervention factor (for do(node=value) operations)
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

// Build initial factors from CPTs
function buildInitialFactors(nodes: NodeWithCPT[]): Factor[] {
  const factors: Factor[] = [];

  for (const node of nodes) {
    factors.push(buildSingleNodeFactor(node));
  }

  return factors;
}

// Multiply two factors
function factorProduct(f1: Factor, f2: Factor): Factor {
  const newScope = unionScopes(f1.scope, f2.scope);
  const table = new Map<string, number>();

  // Enumerate all assignments to the combined scope
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

// Marginalize out a variable
function sumOut(factor: Factor, variable: Id<"nodes">): Factor {
  const newScope = factor.scope.filter((v) => v !== variable);
  const table = new Map<string, number>();

  // Enumerate assignments to the new scope
  const assignments = enumerateBinaryAssignments(newScope);

  for (const assignment of assignments) {
    const key = serializeAssignment(assignment);
    let sum = 0;

    // Sum over both values of the eliminated variable
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

// Variable elimination to compute marginals
function eliminateAllExcept(
  factors: Factor[],
  queryVars: Id<"nodes">[],
): Factor {
  // Determine elimination order (variables not in query)
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

  // Eliminate variables one by one
  for (const variable of eliminationOrder) {
    // Find factors that mention this variable
    const relevant: Factor[] = [];
    const irrelevant: Factor[] = [];

    for (const f of currentFactors) {
      if (f.scope.includes(variable)) {
        relevant.push(f);
      } else {
        irrelevant.push(f);
      }
    }

    // Multiply all relevant factors
    if (relevant.length === 0) continue;

    let product = relevant[0];
    for (let i = 1; i < relevant.length; i++) {
      product = factorProduct(product, relevant[i]);
    }

    // Sum out the variable
    const marginalized = sumOut(product, variable);

    // Update factor list
    currentFactors = [...irrelevant, marginalized];
  }

  // Multiply remaining factors to get final result
  if (currentFactors.length === 0) {
    return { scope: [], table: new Map() };
  }

  let result = currentFactors[0];
  for (let i = 1; i < currentFactors.length; i++) {
    result = factorProduct(result, currentFactors[i]);
  }

  return result;
}

function getParentIds(node: NodeWithCPT): Id<"nodes">[] {
  const parentIds = new Set<Id<"nodes">>();
  for (const entry of node.cptEntries) {
    for (const parentId of Object.keys(entry.parentStates)) {
      parentIds.add(parentId as Id<"nodes">);
    }
  }
  return Array.from(parentIds);
}

function computeAllMarginalsOptimized(
  factors: Factor[],
): Map<Id<"nodes">, number> {
  const probabilities = new Map<Id<"nodes">, number>();

  // Collect all variables from factors
  const allVars = new Set<Id<"nodes">>();
  for (const factor of factors) {
    for (const v of factor.scope) {
      allVars.add(v);
    }
  }

  // We'll eliminate all variables, capturing each marginal before elimination
  const eliminationOrder = Array.from(allVars);
  let currentFactors = [...factors];

  for (const variable of eliminationOrder) {
    // Find factors that mention this variable
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

    // Multiply all relevant factors
    let product = relevant[0];
    for (let i = 1; i < relevant.length; i++) {
      product = factorProduct(product, relevant[i]);
    }

    // Before eliminating, compute and cache this variable's marginal
    const marginalFactor = sumOut(product, variable);

    // Extract P(variable=true) from the product (before summing out)
    // Project product to just this variable to get its marginal
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

    // Now sum out the variable and continue
    currentFactors = [...irrelevant, marginalFactor];
  }

  return probabilities;
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

export function computeMarginalProbabilities(
  nodes: NodeWithCPT[],
  options?: {
    targetNodeId?: Id<"nodes">;
    prebuiltFactors?: Factor[];
  },
): Map<Id<"nodes">, number> {
  if (nodes.length === 0) return new Map();

  // Note: Cycle detection is handled at the database level when adding edges
  // Build initial factors from CPTs (or use provided factors)
  const factors = options?.prebuiltFactors ?? buildInitialFactors(nodes);

  // If computing all nodes (no target specified), use optimized single-pass
  if (!options?.targetNodeId) {
    return computeAllMarginalsOptimized(factors);
  }

  // For single node queries, use the existing elimination approach
  const probabilities = new Map<Id<"nodes">, number>();
  const nodesToCompute = nodes.filter((n) => n._id === options.targetNodeId);

  for (const node of nodesToCompute) {
    const result = eliminateAllExcept(factors, [node._id]);

    // Extract P(node=true) and P(node=false), then normalize
    const trueKey = serializeAssignment(new Map([[node._id, true]]));
    const falseKey = serializeAssignment(new Map([[node._id, false]]));
    const probTrue = result.table.get(trueKey) ?? 0;
    const probFalse = result.table.get(falseKey) ?? 0;
    const total = probTrue + probFalse;

    // Normalize to handle floating-point errors
    // Use very small threshold to handle rare events (e.g., 1e-10 from chained nodes)
    const normalized = total > Number.EPSILON ? probTrue / total : 0.5;

    probabilities.set(node._id, normalized);
  }

  return probabilities;
}

function getAncestors(
  nodeId: Id<"nodes">,
  nodes: NodeWithCPT[],
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

/**
 * Compute causal sensitivity of target node to ancestor nodes using Pearl's do-calculus.
 *
 * For each ancestor node, computes the causal effect on the target:
 * sensitivity = P(target | do(node=true)) - P(target | do(node=false))
 *
 * This measures: "If we intervened to force this node true vs false, how much would
 * the target probability change?"
 *
 * This is mathematically rigorous (Pearl's do-calculus) and handles all edge cases:
 * - Works for nodes with any probability (including 0 or 1)
 * - No ambiguity about "how" the probability changes
 * - Measures true causal influence, not just correlation
 *
 * The intervention do(node=value) means:
 * - Remove all incoming edges to the node (break causal parents)
 * - Set node to the specified value deterministically
 * - Compute downstream effects on the target
 */
export function computeSensitivity(
  nodes: NodeWithCPT[],
  targetNodeId: Id<"nodes">,
): Map<Id<"nodes">, number> {
  const sensitivities = new Map<Id<"nodes">, number>();
  const ancestors = getAncestors(targetNodeId, nodes);

  if (ancestors.size === 0) {
    return sensitivities;
  }

  // Build node lookup map for O(1) access
  const nodeMap = new Map(nodes.map((n) => [n._id, n]));

  // Build baseline factors once (major optimization)
  const baselineFactors = buildInitialFactors(nodes);

  // Iterate ancestors directly (minor optimization)
  for (const ancestorId of ancestors) {
    const ancestorNode = nodeMap.get(ancestorId);
    if (!ancestorNode) continue;

    // Find the index of this ancestor's factor in the baseline
    const ancestorIndex = nodes.findIndex((n) => n._id === ancestorId);
    if (ancestorIndex === -1) continue;

    // Compute P(target | do(ancestor=true))
    // Replace only the ancestor's factor with deterministic intervention
    const factorsTrue = [...baselineFactors];
    factorsTrue[ancestorIndex] = buildInterventionFactor(ancestorId, 1.0);

    const probsTrue = computeMarginalProbabilities(nodes, {
      targetNodeId,
      prebuiltFactors: factorsTrue,
    });

    // Compute P(target | do(ancestor=false))
    const factorsFalse = [...baselineFactors];
    factorsFalse[ancestorIndex] = buildInterventionFactor(ancestorId, 0.0);

    const probsFalse = computeMarginalProbabilities(nodes, {
      targetNodeId,
      prebuiltFactors: factorsFalse,
    });

    const targetTrue = probsTrue.get(targetNodeId) ?? 0.5;
    const targetFalse = probsFalse.get(targetNodeId) ?? 0.5;

    // Causal effect: difference in target probability under the two interventions
    const sensitivity = targetTrue - targetFalse;

    if (Math.abs(sensitivity) > 0.0001) {
      sensitivities.set(ancestorId, sensitivity);
    }
  }

  return sensitivities;
}
