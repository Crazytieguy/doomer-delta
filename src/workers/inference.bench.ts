import { bench, describe } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { WorkerNode } from "../types/workerMessages";
import * as wasm from "../../wasm-inference/pkg/wasm_inference";

function createNode(
  id: string,
  cptEntries: Array<{
    parentStates: Record<string, boolean | null>;
    probability: number;
  }>,
): WorkerNode {
  return {
    _id: id as Id<"nodes">,
    cptEntries,
  };
}

function countStats(nodes: WorkerNode[]): {
  edges: number;
  cptEntries: number;
} {
  let edges = 0;
  let cptEntries = 0;

  for (const node of nodes) {
    const parents = new Set<string>();
    for (const entry of node.cptEntries) {
      cptEntries++;
      for (const parentId of Object.keys(entry.parentStates)) {
        parents.add(parentId);
      }
    }
    edges += parents.size;
  }

  return { edges, cptEntries };
}

function createChain(nodeCount: number): WorkerNode[] {
  const nodes: WorkerNode[] = [];

  for (let i = 0; i < nodeCount; i++) {
    if (i === 0) {
      nodes.push(createNode(`n${i}`, [{ parentStates: {}, probability: 0.6 }]));
    } else {
      const parentId = `n${i - 1}`;
      nodes.push(
        createNode(`n${i}`, [
          { parentStates: { [parentId]: true }, probability: 0.7 },
          { parentStates: { [parentId]: false }, probability: 0.3 },
        ]),
      );
    }
  }

  return nodes;
}

function createNetwork(nodeCount: number, avgParents: number): WorkerNode[] {
  const nodes: WorkerNode[] = [];
  const numRoots = Math.max(2, Math.ceil(nodeCount / 15));

  for (let i = 0; i < numRoots; i++) {
    nodes.push(createNode(`n${i}`, [{ parentStates: {}, probability: 0.5 }]));
  }

  for (let i = numRoots; i < nodeCount; i++) {
    const numParents = Math.max(
      1,
      Math.min(avgParents - 1 + (i % 3), nodes.length),
    );

    const availableParents = nodes.slice(
      Math.max(0, nodes.length - Math.min(10, nodes.length)),
    );
    const selectedParents = availableParents.slice(
      0,
      Math.min(numParents, availableParents.length),
    );

    const cptEntries = [];
    const targetCptCount = numParents * 2;

    for (let c = 0; c < targetCptCount; c++) {
      const parentStates: Record<string, boolean | null> = {};
      for (const parent of selectedParents) {
        if (c === 0) {
          parentStates[parent._id] = Math.random() > 0.5;
        } else if (Math.random() > 0.3) {
          parentStates[parent._id] = Math.random() > 0.5 ? true : null;
        }
      }
      cptEntries.push({
        parentStates,
        probability: 0.3 + Math.random() * 0.4,
      });
    }

    cptEntries.push({ parentStates: {}, probability: 0.5 });

    nodes.push(createNode(`n${i}`, cptEntries));
  }

  return nodes;
}

const smallNetwork = createNetwork(10, 4);
const mediumNetwork = createNetwork(30, 4);
const largeNetwork = createNetwork(100, 4);
const mediumSparseNetwork = createChain(30);
const mediumDenseNetwork = createNetwork(30, 8);

const smallStats = countStats(smallNetwork);
const mediumStats = countStats(mediumNetwork);
const largeStats = countStats(largeNetwork);
const mediumSparseStats = countStats(mediumSparseNetwork);
const mediumDenseStats = countStats(mediumDenseNetwork);

describe("Node scaling (4x edges/node, 100k samples)", () => {
  bench(
    `10 nodes (${(smallStats.cptEntries / 10).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(smallNetwork, 100000);
    },
  );

  bench(
    `30 nodes (${(mediumStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumNetwork, 100000);
    },
  );

  bench(
    `100 nodes (${(largeStats.cptEntries / 100).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(largeNetwork, 100000);
    },
  );
});

describe("Edge density scaling (30 nodes, 100k samples)", () => {
  bench(
    `1x edges/node (${(mediumSparseStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumSparseNetwork, 100000);
    },
  );

  bench(
    `4x edges/node (${(mediumStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumNetwork, 100000);
    },
  );

  bench(
    `8x edges/node (${(mediumDenseStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumDenseNetwork, 100000);
    },
  );
});

describe("Sample count scaling (30 nodes, 4x edges/node)", () => {
  bench(
    `10k samples (${(mediumStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumNetwork, 10000);
    },
  );

  bench(
    `100k samples (${(mediumStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumNetwork, 100000);
    },
  );

  bench(
    `1M samples (${(mediumStats.cptEntries / 30).toFixed(1)} CPT/node)`,
    () => {
      wasm.compute_marginals(mediumNetwork, 1000000);
    },
  );
});
