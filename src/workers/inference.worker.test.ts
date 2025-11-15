import { describe, it, expect } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { WorkerNode } from "../types/workerMessages";
import { computeMarginalProbabilities, computeSensitivity } from "./inference.worker";

const SAMPLING_PRECISION = 2;

function createNode(
  id: string,
  cptEntries: Array<{ parentStates: Record<string, boolean | null>; probability: number }>,
): WorkerNode {
  return {
    _id: id as Id<"nodes">,
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.56, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.7, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.4, SAMPLING_PRECISION);

      const expectedC =
        0.7 * 0.4 * 0.9 +
        0.7 * 0.6 * 0.7 +
        0.3 * 0.4 * 0.6 +
        0.3 * 0.6 * 0.1;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);

      const expectedB = 0.5 * 0.9 + 0.5 * 0.2;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(expectedB, SAMPLING_PRECISION);

      const pBTrue = expectedB;
      const pBFalse = 1 - expectedB;
      const expectedC = pBTrue * 0.8 + pBFalse * 0.1;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, SAMPLING_PRECISION);

      const pB = 0.6 * 0.8 + 0.4 * 0.3;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(pB, SAMPLING_PRECISION);

      const pC = 0.6 * 0.7 + 0.4 * 0.4;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(pC, SAMPLING_PRECISION);

      const pD =
        0.6 * 0.8 * 0.7 * 0.95 +
        0.6 * 0.8 * 0.3 * 0.6 +
        0.6 * 0.2 * 0.7 * 0.5 +
        0.6 * 0.2 * 0.3 * 0.1 +
        0.4 * 0.3 * 0.4 * 0.95 +
        0.4 * 0.3 * 0.6 * 0.6 +
        0.4 * 0.7 * 0.4 * 0.5 +
        0.4 * 0.7 * 0.6 * 0.1;
      expect(probs.get("D" as Id<"nodes">)).toBeCloseTo(pD, SAMPLING_PRECISION);
    });
  });

  describe("Single node", () => {
    it("returns the node's prior probability", () => {
      const node = createNode("X", [{ parentStates: {}, probability: 0.75 }]);

      const probs = computeMarginalProbabilities([node]);

      expect(probs.get("X" as Id<"nodes">)).toBeCloseTo(0.75, SAMPLING_PRECISION);
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

      expect(probs.get("zzz_parent" as Id<"nodes">)).toBeCloseTo(0.3, SAMPLING_PRECISION);
      expect(probs.get("aaa_child" as Id<"nodes">)).toBeCloseTo(0.34, SAMPLING_PRECISION);
    });

    it("handles varied ID ordering in chain", () => {
      const nodeM = createNode("m_middle", [{ parentStates: {}, probability: 0.4 }]);

      const nodeZ = createNode("z_end", [
        { parentStates: { m_middle: true }, probability: 0.7 },
        { parentStates: { m_middle: false }, probability: 0.3 },
      ]);

      const probs = computeMarginalProbabilities([nodeM, nodeZ]);

      expect(probs.get("m_middle" as Id<"nodes">)).toBeCloseTo(0.4, SAMPLING_PRECISION);

      const expectedZ = 0.4 * 0.7 + 0.6 * 0.3;
      expect(probs.get("z_end" as Id<"nodes">)).toBeCloseTo(expectedZ, SAMPLING_PRECISION);
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

      expect(probs.get("node_1" as Id<"nodes">)).toBeCloseTo(0.25, SAMPLING_PRECISION);
      expect(probs.get("node_9" as Id<"nodes">)).toBeCloseTo(0.75, SAMPLING_PRECISION);

      const expected5 =
        0.25 * 0.75 * 0.85 +
        0.25 * 0.25 * 0.15 +
        0.75 * 0.75 * 0.45 +
        0.75 * 0.25 * 0.05;
      expect(probs.get("node_5" as Id<"nodes">)).toBeCloseTo(expected5, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.1, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);
    });

    it("handles balanced parent with highly skewed CPT", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.99 },
        { parentStates: { A: false }, probability: 0.01 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);
    });

    it("handles both parent and CPT highly skewed in same direction", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.9 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.95 },
        { parentStates: { A: false }, probability: 0.05 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.9, SAMPLING_PRECISION);

      const expectedB = 0.9 * 0.95 + 0.1 * 0.05;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(expectedB, SAMPLING_PRECISION);
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

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.8, SAMPLING_PRECISION);

      const p2 = 0.8 * 0.7 + 0.2 * 0.3;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, SAMPLING_PRECISION);

      const p3 = p2 * 0.6 + (1 - p2) * 0.4;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, SAMPLING_PRECISION);

      const p4 = p3 * 0.9 + (1 - p3) * 0.1;
      expect(probs.get("n4" as Id<"nodes">)).toBeCloseTo(p4, SAMPLING_PRECISION);

      const p5 = p4 * 0.85 + (1 - p4) * 0.15;
      expect(probs.get("n5" as Id<"nodes">)).toBeCloseTo(p5, SAMPLING_PRECISION);
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

      expect(probs.get("p" as Id<"nodes">)).toBeCloseTo(0.7, SAMPLING_PRECISION);
      expect(probs.get("c1" as Id<"nodes">)).toBeCloseTo(0.62, SAMPLING_PRECISION);
      expect(probs.get("c2" as Id<"nodes">)).toBeCloseTo(0.66, SAMPLING_PRECISION);
      expect(probs.get("c3" as Id<"nodes">)).toBeCloseTo(0.54, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.001, SAMPLING_PRECISION);

      const expectedB = 0.001 * 0.999 + 0.999 * 0.001;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(expectedB, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.001, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.999, SAMPLING_PRECISION);
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);
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

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.3, SAMPLING_PRECISION);

      const p2 = 0.3 * 0.8 + 0.7 * 0.4;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, SAMPLING_PRECISION);

      const p3 = p2 * 0.9 + (1 - p2) * 0.2;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, SAMPLING_PRECISION);
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

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.3, SAMPLING_PRECISION);

      const p2 = 0.3 * 0.8 + 0.7 * 0.4;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, SAMPLING_PRECISION);

      const p3 = p2 * 0.9 + (1 - p2) * 0.2;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, SAMPLING_PRECISION);
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

      expect(probs.get("X" as Id<"nodes">)).toBeCloseTo(0.2, SAMPLING_PRECISION);

      const pY = 0.2 * 0.95 + 0.8 * 0.15;
      expect(probs.get("Y" as Id<"nodes">)).toBeCloseTo(pY, SAMPLING_PRECISION);

      const pZ = pY * 0.85 + (1 - pY) * 0.25;
      expect(probs.get("Z" as Id<"nodes">)).toBeCloseTo(pZ, SAMPLING_PRECISION);

      const pW = pZ * 0.75 + (1 - pZ) * 0.35;
      expect(probs.get("W" as Id<"nodes">)).toBeCloseTo(pW, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.3, SAMPLING_PRECISION);

      const pB = 0.3 * 0.8 + 0.7 * 0.2;
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(pB, SAMPLING_PRECISION);

      const pC = 0.3 * 0.7 + 0.7 * 0.4;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(pC, SAMPLING_PRECISION);

      const pD =
        0.3 * 0.8 * 0.7 * 0.9 +
        0.3 * 0.8 * 0.3 * 0.6 +
        0.3 * 0.2 * 0.7 * 0.5 +
        0.3 * 0.2 * 0.3 * 0.1 +
        0.7 * 0.2 * 0.4 * 0.9 +
        0.7 * 0.2 * 0.6 * 0.6 +
        0.7 * 0.8 * 0.4 * 0.5 +
        0.7 * 0.8 * 0.6 * 0.1;
      expect(probs.get("D" as Id<"nodes">)).toBeCloseTo(pD, SAMPLING_PRECISION);
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

      expect(probs.get("n1" as Id<"nodes">)).toBeCloseTo(0.1, SAMPLING_PRECISION);

      const p2 = 0.1 * 0.9 + 0.9 * 0.2;
      expect(probs.get("n2" as Id<"nodes">)).toBeCloseTo(p2, SAMPLING_PRECISION);

      const p3 = p2 * 0.8 + (1 - p2) * 0.3;
      expect(probs.get("n3" as Id<"nodes">)).toBeCloseTo(p3, SAMPLING_PRECISION);

      const p4 = p3 * 0.7 + (1 - p3) * 0.4;
      expect(probs.get("n4" as Id<"nodes">)).toBeCloseTo(p4, SAMPLING_PRECISION);

      const p5 = p4 * 0.85 + (1 - p4) * 0.15;
      expect(probs.get("n5" as Id<"nodes">)).toBeCloseTo(p5, SAMPLING_PRECISION);

      const p6 = p5 * 0.75 + (1 - p5) * 0.25;
      expect(probs.get("n6" as Id<"nodes">)).toBeCloseTo(p6, SAMPLING_PRECISION);

      const p7 = p6 * 0.95 + (1 - p6) * 0.35;
      expect(probs.get("n7" as Id<"nodes">)).toBeCloseTo(p7, SAMPLING_PRECISION);

      const p8 = p7 * 0.88 + (1 - p7) * 0.22;
      expect(probs.get("n8" as Id<"nodes">)).toBeCloseTo(p8, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.4, SAMPLING_PRECISION);

      const expectedC = 0.6 * 0.8 + 0.4 * 0.2;
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, SAMPLING_PRECISION);
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
      expect(probs.get("C" as Id<"nodes">)).toBeCloseTo(expectedC, SAMPLING_PRECISION);
    });
  });

  describe("Query API", () => {
    it("computes all node marginals", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);
      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.9 },
        { parentStates: { A: false }, probability: 0.1 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.7, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.66, SAMPLING_PRECISION);
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

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.0, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);
    });

    it("handles probability of 1.0", () => {
      const nodeA = createNode("A", [{ parentStates: {}, probability: 1.0 }]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.3 },
        { parentStates: { A: false }, probability: 0.9 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(1.0, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.3, SAMPLING_PRECISION);
    });
  });

  describe("Bitmask limits", () => {
    it("handles node with exactly 31 parents", () => {
      const parents: WorkerNode[] = [];
      const parentStates: Record<string, boolean | null> = {};

      for (let i = 0; i < 31; i++) {
        const parentId = `p${i}` as Id<"nodes">;
        parents.push(createNode(parentId, [{ parentStates: {}, probability: 0.5 }]));
        parentStates[parentId] = i % 2 === 0;
      }

      const child = createNode("child", [
        { parentStates, probability: 0.8 },
        { parentStates: {}, probability: 0.5 },
      ]);

      const probs = computeMarginalProbabilities([...parents, child]);

      expect(probs.get("child" as Id<"nodes">)).toBeDefined();
      expect(probs.get("child" as Id<"nodes">)).toBeGreaterThan(0);
      expect(probs.get("child" as Id<"nodes">)).toBeLessThan(1);
    });

    it("handles node with more than 31 parents", () => {
      const parents: WorkerNode[] = [];
      const parentStates: Record<string, boolean | null> = {};

      for (let i = 0; i < 32; i++) {
        const parentId = `p${i}` as Id<"nodes">;
        parents.push(createNode(parentId, [{ parentStates: {}, probability: 0.5 }]));
        parentStates[parentId] = true;
      }

      const child = createNode("child", [
        { parentStates, probability: 0.8 },
        { parentStates: {}, probability: 0.5 },
      ]);

      const probs = computeMarginalProbabilities([...parents, child]);

      expect(probs.get("child" as Id<"nodes">)).toBeCloseTo(0.5, SAMPLING_PRECISION);
    });
  });

  describe("Missing parent validation", () => {
    it("throws error when parent node is missing from array", () => {
      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.8 },
        { parentStates: { A: false }, probability: 0.2 },
      ]);

      expect(() => {
        computeMarginalProbabilities([nodeB]);
      }).toThrow(/references parent.*which is not in the node array/);
    });
  });

  describe("Duplicate wildcard entries (root nodes)", () => {
    it("uses first wildcard entry when multiple exist", () => {
      const node = createNode("A", [
        { parentStates: {}, probability: 0.7 },
        { parentStates: {}, probability: 0.4 },
        { parentStates: {}, probability: 0.9 },
      ]);

      const probs = computeMarginalProbabilities([node]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.7, SAMPLING_PRECISION);
    });

    it("handles duplicate wildcards in chain correctly", () => {
      const nodeA = createNode("A", [
        { parentStates: {}, probability: 0.6 },
        { parentStates: {}, probability: 0.3 },
      ]);

      const nodeB = createNode("B", [
        { parentStates: { A: true }, probability: 0.8 },
        { parentStates: { A: false }, probability: 0.2 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("A" as Id<"nodes">)).toBeCloseTo(0.6, SAMPLING_PRECISION);
      expect(probs.get("B" as Id<"nodes">)).toBeCloseTo(0.56, SAMPLING_PRECISION);
    });
  });

  describe("Sensitivity Analysis", () => {
    describe("Simple A→B network", () => {
      it("computes sensitivity of B to A", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">);

        expect(sensitivities.size).toBe(1);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.get("A" as Id<"nodes">)).toBeCloseTo(0.6, 1);
      });

      it("returns empty map for root node with no ancestors", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "A" as Id<"nodes">);

        expect(sensitivities.size).toBe(0);
      });
    });

    describe("Chain A→B→C network", () => {
      it("includes all ancestors in sensitivity analysis", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.3 },
        ]);
        const nodeC = createNode("C", [
          { parentStates: { B: true }, probability: 0.9 },
          { parentStates: { B: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC], "C" as Id<"nodes">);

        expect(sensitivities.size).toBe(2);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("B" as Id<"nodes">)).toBe(true);
      });
    });

    describe("V-structure (A→C←B)", () => {
      it("includes both parents in sensitivity", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);
        const nodeB = createNode("B", [{ parentStates: {}, probability: 0.4 }]);
        const nodeC = createNode("C", [
          { parentStates: { A: true, B: true }, probability: 0.9 },
          { parentStates: { A: true, B: false }, probability: 0.7 },
          { parentStates: { A: false, B: true }, probability: 0.6 },
          { parentStates: { A: false, B: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC], "C" as Id<"nodes">);

        expect(sensitivities.size).toBe(2);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("B" as Id<"nodes">)).toBe(true);
      });
    });

    describe("Sensitivity value bounds", () => {
      it("returns values between -1 and 1", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);
        const nodeB = createNode("B", [{ parentStates: {}, probability: 0.5 }]);
        const nodeC = createNode("C", [
          { parentStates: { A: true, B: true }, probability: 0.9 },
          { parentStates: { A: true, B: false }, probability: 0.7 },
          { parentStates: { A: false, B: true }, probability: 0.3 },
          { parentStates: { A: false, B: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC], "C" as Id<"nodes">, 100000);

        for (const [_nodeId, sensitivity] of sensitivities) {
          expect(sensitivity).toBeGreaterThanOrEqual(-1);
          expect(sensitivity).toBeLessThanOrEqual(1);
        }
      });
    });

    describe("Diamond structure (A→B, A→C, B→D, C→D)", () => {
      it("includes all ancestors through multiple paths", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.7 },
          { parentStates: { A: false }, probability: 0.3 },
        ]);
        const nodeC = createNode("C", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);
        const nodeD = createNode("D", [
          { parentStates: { B: true, C: true }, probability: 0.95 },
          { parentStates: { B: true, C: false }, probability: 0.6 },
          { parentStates: { B: false, C: true }, probability: 0.5 },
          { parentStates: { B: false, C: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC, nodeD], "D" as Id<"nodes">);

        expect(sensitivities.size).toBe(3);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("B" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("C" as Id<"nodes">)).toBe(true);
      });

      it("computes non-zero sensitivity for distant ancestor A", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.7 },
          { parentStates: { A: false }, probability: 0.3 },
        ]);
        const nodeC = createNode("C", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);
        const nodeD = createNode("D", [
          { parentStates: { B: true, C: true }, probability: 0.95 },
          { parentStates: { B: true, C: false }, probability: 0.6 },
          { parentStates: { B: false, C: true }, probability: 0.5 },
          { parentStates: { B: false, C: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC, nodeD], "D" as Id<"nodes">);

        const sensitivityA = sensitivities.get("A" as Id<"nodes">);
        expect(sensitivityA).toBeDefined();
        expect(Math.abs(sensitivityA!)).toBeGreaterThan(0.1);
      });
    });

    describe("Long chain (5 nodes)", () => {
      it("includes all ancestors in long chain", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);
        const nodeC = createNode("C", [
          { parentStates: { B: true }, probability: 0.75 },
          { parentStates: { B: false }, probability: 0.25 },
        ]);
        const nodeD = createNode("D", [
          { parentStates: { C: true }, probability: 0.85 },
          { parentStates: { C: false }, probability: 0.15 },
        ]);
        const nodeE = createNode("E", [
          { parentStates: { D: true }, probability: 0.9 },
          { parentStates: { D: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC, nodeD, nodeE], "E" as Id<"nodes">);

        expect(sensitivities.size).toBe(4);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("B" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("C" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("D" as Id<"nodes">)).toBe(true);
      });

      it("shows decreasing sensitivity with distance", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.7 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);
        const nodeC = createNode("C", [
          { parentStates: { B: true }, probability: 0.75 },
          { parentStates: { B: false }, probability: 0.25 },
        ]);
        const nodeD = createNode("D", [
          { parentStates: { C: true }, probability: 0.85 },
          { parentStates: { C: false }, probability: 0.15 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC, nodeD], "D" as Id<"nodes">, 100000);

        const sensA = Math.abs(sensitivities.get("A" as Id<"nodes">)!);
        const sensB = Math.abs(sensitivities.get("B" as Id<"nodes">)!);
        const sensC = Math.abs(sensitivities.get("C" as Id<"nodes">)!);

        expect(sensC).toBeGreaterThan(sensB);
        expect(sensB).toBeGreaterThan(sensA);
      });
    });

    describe("Disconnected nodes", () => {
      it("excludes nodes that are not ancestors", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.8 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);
        const nodeX = createNode("X", [{ parentStates: {}, probability: 0.5 }]);
        const nodeY = createNode("Y", [
          { parentStates: { X: true }, probability: 0.7 },
          { parentStates: { X: false }, probability: 0.3 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeX, nodeY], "B" as Id<"nodes">);

        expect(sensitivities.size).toBe(1);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("X" as Id<"nodes">)).toBe(false);
        expect(sensitivities.has("Y" as Id<"nodes">)).toBe(false);
      });
    });

    describe("Negative sensitivity", () => {
      it("computes negative sensitivity when intervention reduces probability", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.2 },
          { parentStates: { A: false }, probability: 0.8 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">, 100000);

        const sensitivityA = sensitivities.get("A" as Id<"nodes">);
        expect(sensitivityA).toBeDefined();
        expect(sensitivityA!).toBeLessThan(0);
        expect(sensitivityA!).toBeCloseTo(-0.6, 1);
      });
    });

    describe("Three-parent node", () => {
      it("includes all three parents in sensitivity", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [{ parentStates: {}, probability: 0.5 }]);
        const nodeC = createNode("C", [{ parentStates: {}, probability: 0.4 }]);
        const nodeD = createNode("D", [
          { parentStates: { A: true, B: true, C: true }, probability: 0.95 },
          { parentStates: { A: true, B: true, C: false }, probability: 0.7 },
          { parentStates: { A: true, B: false, C: true }, probability: 0.6 },
          { parentStates: { A: false, B: true, C: true }, probability: 0.5 },
          { parentStates: {}, probability: 0.3 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC, nodeD], "D" as Id<"nodes">);

        expect(sensitivities.size).toBe(3);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("B" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("C" as Id<"nodes">)).toBe(true);
      });
    });

    describe("Wildcard CPT in sensitivity", () => {
      it("handles wildcards in target node CPT", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [{ parentStates: {}, probability: 0.5 }]);
        const nodeC = createNode("C", [
          { parentStates: { A: true, B: null }, probability: 0.8 },
          { parentStates: { A: false, B: null }, probability: 0.3 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC], "C" as Id<"nodes">);

        expect(sensitivities.size).toBe(2);
        expect(sensitivities.has("A" as Id<"nodes">)).toBe(true);
        expect(sensitivities.has("B" as Id<"nodes">)).toBe(true);
      });
    });

    describe("Asymmetric probabilities", () => {
      it("computes sensitivity with extreme probabilities", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.99 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.95 },
          { parentStates: { A: false }, probability: 0.05 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">, 100000);

        const sensitivityA = sensitivities.get("A" as Id<"nodes">);
        expect(sensitivityA).toBeDefined();
        expect(sensitivityA!).toBeGreaterThan(0.8);
        expect(sensitivityA!).toBeLessThan(1.0);
      });
    });

    describe("Intervention validation", () => {
      it("computes correct sensitivity with known intervention effects", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.9 },
          { parentStates: { A: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">, 100000);

        const sensitivityA = sensitivities.get("A" as Id<"nodes">);
        expect(sensitivityA).toBeDefined();
        expect(sensitivityA!).toBeCloseTo(0.8, 1);
      });

      it("intervention on true forces probability to 1.0", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.3 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 0.7 },
          { parentStates: { A: false }, probability: 0.2 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">, 100000);

        const sensitivityA = sensitivities.get("A" as Id<"nodes">);
        expect(sensitivityA).toBeDefined();
        expect(sensitivityA!).toBeCloseTo(0.5, 1);
      });

      it("intervention breaks correlation correctly", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.6 }]);
        const nodeB = createNode("B", [
          { parentStates: { A: true }, probability: 1.0 },
          { parentStates: { A: false }, probability: 0.0 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">, 100000);

        const sensitivityA = sensitivities.get("A" as Id<"nodes">);
        expect(sensitivityA).toBeDefined();
        expect(sensitivityA!).toBeCloseTo(1.0, 1);
      });

      it("intervention on independent nodes shows zero sensitivity", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.5 }]);
        const nodeB = createNode("B", [{ parentStates: {}, probability: 0.7 }]);

        const sensitivities = computeSensitivity([nodeA, nodeB], "B" as Id<"nodes">, 100000);

        expect(sensitivities.size).toBe(0);
      });

      it("intervention respects conditional probabilities", () => {
        const nodeA = createNode("A", [{ parentStates: {}, probability: 0.4 }]);
        const nodeB = createNode("B", [{ parentStates: {}, probability: 0.6 }]);
        const nodeC = createNode("C", [
          { parentStates: { A: true, B: true }, probability: 0.95 },
          { parentStates: { A: true, B: false }, probability: 0.6 },
          { parentStates: { A: false, B: true }, probability: 0.5 },
          { parentStates: { A: false, B: false }, probability: 0.1 },
        ]);

        const sensitivities = computeSensitivity([nodeA, nodeB, nodeC], "C" as Id<"nodes">, 100000);

        const sensA = sensitivities.get("A" as Id<"nodes">);
        const sensB = sensitivities.get("B" as Id<"nodes">);

        expect(sensA).toBeDefined();
        expect(sensB).toBeDefined();
        expect(Math.abs(sensA!)).toBeGreaterThan(0.1);
        expect(Math.abs(sensB!)).toBeGreaterThan(0.1);
      });
    });
  });
});
