import { describe, it, expect } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { WorkerNode } from "../types/workerMessages";
import { computeMarginalProbabilities } from "./inference.worker";

function createNode(
  id: string,
  cptEntries: Array<{ parentStates: Record<string, boolean | null>; probability: number }>,
): WorkerNode {
  return {
    _id: id as Id<"nodes">,
    modelId: "test-model" as Id<"models">,
    title: `Node ${id}`,
    x: 0,
    y: 0,
    cptEntries,
  };
}

describe("Bayesian Inference", () => {
  describe("Simple A→B network", () => {
    it("computes correct marginal probabilities", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.8 },
        { parentStates: { A: false }, probability: 0.2 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.56, 5);
    });
  });

  describe("V-structure (A→C←B)", () => {
    it("preserves marginal independence", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);

      const nodeB = createNode("B", [{ parentStates: {}, probability: 0.4 }]);

      const nodeC = createNode("C", [
        { parentStates: { A: true, B: true }, probability: 0.9 },
        { parentStates: { A: true, B: false }, probability: 0.7 },
        { parentStates: { A: false, B: true }, probability: 0.6 },
        { parentStates: { A: false, B: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB, nodeC]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.7, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.4, 5);

      const expectedC =
        0.7 * 0.4 * 0.9 +
        0.7 * 0.6 * 0.7 +
        0.3 * 0.4 * 0.6 +
        0.3 * 0.6 * 0.1;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, 5);
    });
  });

  describe("Chain A→B→C", () => {
    it("computes transitive dependencies correctly", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.9 },
        { parentStates: { A: false }, probability: 0.2 },
      ]);

      const nodeC = createNode("C", [
        { parentStates: { B: true }, probability: 0.8 },
        { parentStates: { B: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB, nodeC]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.5, 5);

      const expectedB = 0.5 * 0.9 + 0.5 * 0.2;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(expectedB, 5);

      const pBTrue = expectedB;
      const pBFalse = 1 - expectedB;
      const expectedC = pBTrue * 0.8 + pBFalse * 0.1;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, 5);
    });
  });

  describe("Diamond (A→B→D, A→C→D)", () => {
    it("handles multiple paths correctly", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.8 },
        { parentStates: { A: false }, probability: 0.3 },
      ]);

      const nodeC = createNode("C", [
        { parentStates: { A: true }, probability: 0.7 },
        { parentStates: { A: false }, probability: 0.4 },
      ]);

      const nodeD = createNode("D", [
        { parentStates: { B: true, C: true }, probability: 0.95 },
        { parentStates: { B: true, C: false }, probability: 0.6 },
        { parentStates: { B: false, C: true }, probability: 0.5 },
        { parentStates: { B: false, C: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB, nodeC, nodeD]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, 5);

      const pB = 0.6 * 0.8 + 0.4 * 0.3;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(pB, 5);

      const pC = 0.6 * 0.7 + 0.4 * 0.4;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(pC, 5);

      const pD =
        0.6 * 0.8 * 0.7 * 0.95 +
        0.6 * 0.8 * 0.3 * 0.6 +
        0.6 * 0.2 * 0.7 * 0.5 +
        0.6 * 0.2 * 0.3 * 0.1 +
        0.4 * 0.3 * 0.4 * 0.95 +
        0.4 * 0.3 * 0.6 * 0.6 +
        0.4 * 0.7 * 0.4 * 0.5 +
        0.4 * 0.7 * 0.6 * 0.1;
      expect(probs.get("D" as Id<"nodes">)).toBeCloseTo(pD, 5);
    });
  });

  describe("Single node", () => {
    it("returns the node's prior probability", () => {
      const node = createNode("X", [{ parentStates: {}, probability: 0.75 }]);

      const probs = computeMarginalProbabilities([node]);

      expect(probs.get("X" as Id<"nodes">)).toBeCloseTo(0.75, 5);
    });
  });

  describe("Varied node ID orders", () => {
    it("handles parent with lexicographically later ID", () => {
      const nodeZ = createNode("zzz_parent", [{ parentStates: {}, probability: 0.3 }]);

      const nodeA = createNode("aaa_child", [
        { parentStates: { zzz_parent: true }, probability: 0.9 },
        { parentStates: { zzz_parent: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeZ, nodeA]);

      expect(probs.get("zzz_parent" as Id<"nodes">)).toBeCloseTo(0.3, 5);
      expect(probs.get("aaa_child" as Id<"nodes">)).toBeCloseTo(0.34, 5);
    });

    it("handles varied ID ordering in chain", () => {
      const nodeM = createNode("m_middle", [{ parentStates: {}, probability: 0.4 }]);

      const nodeZ = createNode("z_end", [
        { parentStates: { m_middle: true }, probability: 0.7 },
        { parentStates: { m_middle: false }, probability: 0.3 },
      ]);

      const probs = computeMarginalProbabilities([nodeM, nodeZ]);

      expect(probs.get("m_middle" as Id<"nodes">)).toBeCloseTo(0.4, 5);

      const expectedZ = 0.4 * 0.7 + 0.6 * 0.3;
      expect(probs.get("z_end" as Id<"nodes">)).toBeCloseTo(expectedZ, 5);
    });

    it("handles complex network with mixed ID ordering", () => {
      const node1 = createNode("node_1", [{ parentStates: {}, probability: 0.25 }]);
      const node9 = createNode("node_9", [{ parentStates: {}, probability: 0.75 }]);

      const node5 = createNode("node_5", [
        { parentStates: { node_1: true, node_9: true }, probability: 0.85 },
        { parentStates: { node_1: true, node_9: false }, probability: 0.15 },
        { parentStates: { node_1: false, node_9: true }, probability: 0.45 },
        { parentStates: { node_1: false, node_9: false }, probability: 0.05 },
      ]);

      const probs = computeMarginalProbabilities([node1, node9, node5]);

      expect(probs.get("node_1" as Id<"nodes">)).toBeCloseTo(0.25, 5);
      expect(probs.get("node_9" as Id<"nodes">)).toBeCloseTo(0.75, 5);

      const expected5 =
        0.25 * 0.75 * 0.85 +
        0.25 * 0.25 * 0.15 +
        0.75 * 0.75 * 0.45 +
        0.75 * 0.25 * 0.05;
      expect(probs.get("node_5" as Id<"nodes">)).toBeCloseTo(expected5, 5);
    });
  });

  describe("Asymmetric probabilities", () => {
    it("handles highly skewed parent prior with balanced CPT", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.1 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.5 },
        { parentStates: { A: false }, probability: 0.5 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.1, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.5, 5);
    });

    it("handles balanced parent with highly skewed CPT", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.99 },
        { parentStates: { A: false }, probability: 0.01 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.5, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.5, 5);
    });

    it("handles both parent and CPT highly skewed in same direction", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.9 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.95 },
        { parentStates: { A: false }, probability: 0.05 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.9, 5);

      const expectedB = 0.9 * 0.95 + 0.1 * 0.05;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(expectedB, 5);
    });
  });

  describe("Deep chains", () => {
    it("handles 5-node chain", () => {
      const node1 = createNode("n1", [{ parentStates: {}, probability: 0.8 }]);
      const node2 = createNode("n2", [
        { parentStates: { n1: true }, probability: 0.7 },
        { parentStates: { n1: false }, probability: 0.3 },
      ]);
      const node3 = createNode("n3", [
        { parentStates: { n2: true }, probability: 0.6 },
        { parentStates: { n2: false }, probability: 0.4 },
      ]);
      const node4 = createNode("n4", [
        { parentStates: { n3: true }, probability: 0.9 },
        { parentStates: { n3: false }, probability: 0.1 },
      ]);
      const node5 = createNode("n5", [
        { parentStates: { n4: true }, probability: 0.85 },
        { parentStates: { n4: false }, probability: 0.15 },
      ]);

      const probs = computeMarginalProbabilities([node1, node2, node3, node4, node5]);

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.8, 5);

      const p2 = 0.8 * 0.7 + 0.2 * 0.3;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, 5);

      const p3 = p2 * 0.6 + (1 - p2) * 0.4;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, 5);

      const p4 = p3 * 0.9 + (1 - p3) * 0.1;
      expect(probs.get("n4" as Id<"nodes">)).toBeCloseTo(p4, 5);

      const p5 = p4 * 0.85 + (1 - p4) * 0.15;
      expect(probs.get("n5" as Id<"nodes">)).toBeCloseTo(p5, 5);
    });
  });

  describe("Multiple children forcing child-first elimination", () => {
    it("handles parent with 3 children (should eliminate children first)", () => {
      const parent = createNode("p", [{ parentStates: {}, probability: 0.7 }]);

      const child1 = createNode("c1", [
        { parentStates: { p: true }, probability: 0.8 },
        { parentStates: { p: false }, probability: 0.2 },
      ]);

      const child2 = createNode("c2", [
        { parentStates: { p: true }, probability: 0.9 },
        { parentStates: { p: false }, probability: 0.1 },
      ]);

      const child3 = createNode("c3", [
        { parentStates: { p: true }, probability: 0.6 },
        { parentStates: { p: false }, probability: 0.4 },
      ]);

      const probs = computeMarginalProbabilities([parent, child1, child2, child3]);

      expect(probs.get("p" as Id<"nodes">)).toBeCloseTo(0.7, 5);
      expect(probs.get("c1" as Id<"nodes">)).toBeCloseTo(0.62, 5);
      expect(probs.get("c2" as Id<"nodes">)).toBeCloseTo(0.66, 5);
      expect(probs.get("c3" as Id<"nodes">)).toBeCloseTo(0.54, 5);
    });
  });

  describe("Extreme probabilities to expose rounding", () => {
    it("handles very small probabilities", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.001 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.999 },
        { parentStates: { A: false }, probability: 0.001 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.001, 5);

      const expectedB = 0.001 * 0.999 + 0.999 * 0.001;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(expectedB, 5);
    });

    it("handles mix of very high and very low probabilities", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.001 }]);
      const nodeB = createNode("B", [{ parentStates: {}, probability: 0.999 }]);

      const nodeC = createNode("C", [
        { parentStates: { A: true, B: true }, probability: 0.5 },
        { parentStates: { A: true, B: false }, probability: 0.5 },
        { parentStates: { A: false, B: true }, probability: 0.5 },
        { parentStates: { A: false, B: false }, probability: 0.5 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB, nodeC]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.001, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.999, 5);
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(0.5, 5);
    });
  });

  describe("Transitive closure in marginal computation", () => {
    it("includes all necessary priors for chain with non-uniform root", () => {
      const node1 = createNode("n1", [{ parentStates: {}, probability: 0.3 }]);
      const node2 = createNode("n2", [
        { parentStates: { n1: true }, probability: 0.8 },
        { parentStates: { n1: false }, probability: 0.4 },
      ]);
      const node3 = createNode("n3", [
        { parentStates: { n2: true }, probability: 0.9 },
        { parentStates: { n2: false }, probability: 0.2 },
      ]);

      const probs = computeMarginalProbabilities([node1, node2, node3]);

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.3, 5);

      const p2 = 0.3 * 0.8 + 0.7 * 0.4;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, 5);

      const p3 = p2 * 0.9 + (1 - p2) * 0.2;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, 5);
    });

    it("handles chain with reversed node array order (child-first)", () => {
      const node1 = createNode("n1", [{ parentStates: {}, probability: 0.3 }]);
      const node2 = createNode("n2", [
        { parentStates: { n1: true }, probability: 0.8 },
        { parentStates: { n1: false }, probability: 0.4 },
      ]);
      const node3 = createNode("n3", [
        { parentStates: { n2: true }, probability: 0.9 },
        { parentStates: { n2: false }, probability: 0.2 },
      ]);

      const probs = computeMarginalProbabilities([node3, node2, node1]);

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.3, 5);

      const p2 = 0.3 * 0.8 + 0.7 * 0.4;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, 5);

      const p3 = p2 * 0.9 + (1 - p2) * 0.2;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, 5);
    });

    it("handles longer chain X→Y→Z→W with skewed priors", () => {
      const nodeX = createNode("X", [{ parentStates: {}, probability: 0.2 }]);
      const nodeY = createNode("Y", [
        { parentStates: { X: true }, probability: 0.95 },
        { parentStates: { X: false }, probability: 0.15 },
      ]);
      const nodeZ = createNode("Z", [
        { parentStates: { Y: true }, probability: 0.85 },
        { parentStates: { Y: false }, probability: 0.25 },
      ]);
      const nodeW = createNode("W", [
        { parentStates: { Z: true }, probability: 0.75 },
        { parentStates: { Z: false }, probability: 0.35 },
      ]);

      const probs = computeMarginalProbabilities([nodeX, nodeY, nodeZ, nodeW]);

      expect(probs.get("X" as Id<"nodes">)).toBeCloseTo(0.2, 5);

      const pY = 0.2 * 0.95 + 0.8 * 0.15;
      expect(probs.get("Y" as Id<"nodes">)).toBeCloseTo(pY, 5);

      const pZ = pY * 0.85 + (1 - pY) * 0.25;
      expect(probs.get("Z" as Id<"nodes">)).toBeCloseTo(pZ, 5);

      const pW = pZ * 0.75 + (1 - pZ) * 0.35;
      expect(probs.get("W" as Id<"nodes">)).toBeCloseTo(pW, 5);
    });

    it("handles Y-structure (A→B→D, A→C→D) with random ordering", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.3 }]);
      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.8 },
        { parentStates: { A: false }, probability: 0.2 },
      ]);
      const nodeC = createNode("C", [
        { parentStates: { A: true }, probability: 0.7 },
        { parentStates: { A: false }, probability: 0.4 },
      ]);
      const nodeD = createNode("D", [
        { parentStates: { B: true, C: true }, probability: 0.9 },
        { parentStates: { B: true, C: false }, probability: 0.6 },
        { parentStates: { B: false, C: true }, probability: 0.5 },
        { parentStates: { B: false, C: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeD, nodeB, nodeA, nodeC]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.3, 5);

      const pB = 0.3 * 0.8 + 0.7 * 0.2;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(pB, 5);

      const pC = 0.3 * 0.7 + 0.7 * 0.4;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(pC, 5);

      const pD =
        0.3 * 0.8 * 0.7 * 0.9 +
        0.3 * 0.8 * 0.3 * 0.6 +
        0.3 * 0.2 * 0.7 * 0.5 +
        0.3 * 0.2 * 0.3 * 0.1 +
        0.7 * 0.2 * 0.4 * 0.9 +
        0.7 * 0.2 * 0.6 * 0.6 +
        0.7 * 0.8 * 0.4 * 0.5 +
        0.7 * 0.8 * 0.6 * 0.1;
      expect(probs.get("D" as Id<"nodes">)).toBeCloseTo(pD, 5);
    });

    it("handles deep chain (8 nodes) with random ordering", () => {
      const n1 = createNode("n1", [{ parentStates: {}, probability: 0.1 }]);
      const n2 = createNode("n2", [
        { parentStates: { n1: true }, probability: 0.9 },
        { parentStates: { n1: false }, probability: 0.2 },
      ]);
      const n3 = createNode("n3", [
        { parentStates: { n2: true }, probability: 0.8 },
        { parentStates: { n2: false }, probability: 0.3 },
      ]);
      const n4 = createNode("n4", [
        { parentStates: { n3: true }, probability: 0.7 },
        { parentStates: { n3: false }, probability: 0.4 },
      ]);
      const n5 = createNode("n5", [
        { parentStates: { n4: true }, probability: 0.85 },
        { parentStates: { n4: false }, probability: 0.15 },
      ]);
      const n6 = createNode("n6", [
        { parentStates: { n5: true }, probability: 0.75 },
        { parentStates: { n5: false }, probability: 0.25 },
      ]);
      const n7 = createNode("n7", [
        { parentStates: { n6: true }, probability: 0.95 },
        { parentStates: { n6: false }, probability: 0.35 },
      ]);
      const n8 = createNode("n8", [
        { parentStates: { n7: true }, probability: 0.88 },
        { parentStates: { n7: false }, probability: 0.22 },
      ]);

      const probs = computeMarginalProbabilities([
        n5,
        n8,
        n2,
        n6,
        n1,
        n4,
        n7,
        n3,
      ]);

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.1, 5);

      const p2 = 0.1 * 0.9 + 0.9 * 0.2;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, 5);

      const p3 = p2 * 0.8 + (1 - p2) * 0.3;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, 5);

      const p4 = p3 * 0.7 + (1 - p3) * 0.4;
      expect(probs.get("n4" as Id<"nodes">)).toBeCloseTo(p4, 5);

      const p5 = p4 * 0.85 + (1 - p4) * 0.15;
      expect(probs.get("n5" as Id<"nodes">)).toBeCloseTo(p5, 5);

      const p6 = p5 * 0.75 + (1 - p5) * 0.25;
      expect(probs.get("n6" as Id<"nodes">)).toBeCloseTo(p6, 5);

      const p7 = p6 * 0.95 + (1 - p6) * 0.35;
      expect(probs.get("n7" as Id<"nodes">)).toBeCloseTo(p7, 5);

      const p8 = p7 * 0.88 + (1 - p7) * 0.22;
      expect(probs.get("n8" as Id<"nodes">)).toBeCloseTo(p8, 5);
    });
  });

  describe("Wildcard CPT entries", () => {
    it("handles null parent states (wildcards)", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
      const nodeB = createNode("B", [{ parentStates: {}, probability: 0.4 }]);

      const nodeC = createNode("C", [
        { parentStates: { A: true, B: null }, probability: 0.8 },
        { parentStates: { A: false, B: null }, probability: 0.2 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB, nodeC]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.4, 5);

      const expectedC = 0.6 * 0.8 + 0.4 * 0.2;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, 5);
    });

    it("prefers specific over wildcard entries", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);
      const nodeB = createNode("B", [{ parentStates: {}, probability: 0.5 }]);

      const nodeC = createNode("C", [
        { parentStates: { A: true, B: true }, probability: 0.95 },
        { parentStates: { A: true, B: null }, probability: 0.6 },
        { parentStates: { A: null, B: null }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB, nodeC]);

      const expectedC =
        0.5 * 0.5 * 0.95 +
        0.5 * 0.5 * 0.6 +
        0.5 * 0.5 * 0.1 +
        0.5 * 0.5 * 0.1;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, 5);
    });
  });

  describe("Query API", () => {
    it("computes single target marginal with targetNodeId", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);
      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.9 },
        { parentStates: { A: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB], {
        targetNodeId: "B" as Id<"nodes">,
      });

      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.66, 5);
      expect(probs.get("A" as Id<"nodes">)).toBeUndefined();
    });

    it("handles empty nodes array", () => {
      const probs = computeMarginalProbabilities([]);

      expect(probs.size).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("handles zero probability", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.0 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 1.0 },
        { parentStates: { A: false }, probability: 0.5 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.0, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.5, 5);
    });

    it("handles probability of 1.0", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 1.0 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.3 },
        { parentStates: { A: false }, probability: 0.9 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(1.0, 5);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.3, 5);
    });
  });
});
