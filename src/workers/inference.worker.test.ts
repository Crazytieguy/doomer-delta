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

  describe("Regression: min-fill bug with unweighted priors", () => {
    it("computes weighted marginals even when child eliminated before parent", () => {
      const nodeA = createNode("node_a", [{ parentStates: {}, probability: 0.6 }]);

      const nodeB = createNode("node_b", [
        { parentStates: { node_a: true }, probability: 0.8 },
        { parentStates: { node_a: false }, probability: 0.2 },
      ]);

      const probs = computeMarginalProbabilities([nodeA, nodeB]);

      expect(probs.get("node_a" as Id<"nodes">)).toBeCloseTo(0.6, 5);
      expect(probs.get("node_b" as Id<"nodes">)).toBeCloseTo(0.56, 5);
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
