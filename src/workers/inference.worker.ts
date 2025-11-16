import type { Id } from "../../convex/_generated/dataModel";
import { workerRequestSchema, type WorkerNode } from "../types/workerMessages";
import * as wasm from "../../wasm-inference/pkg";

const DEFAULT_NUM_SAMPLES = 100000;
const SENSITIVITY_NUM_SAMPLES = 50000;

function computeMarginalProbabilities(
  nodes: WorkerNode[],
  numSamples: number = DEFAULT_NUM_SAMPLES,
): Map<Id<"nodes">, number> {
  if (nodes.length === 0) return new Map();
  if (numSamples <= 0) throw new Error("numSamples must be positive");

  return wasm.compute_marginals(nodes, numSamples) as Map<Id<"nodes">, number>;
}

function computeSensitivity(
  nodes: WorkerNode[],
  targetNodeId: Id<"nodes">,
  numSamples: number = SENSITIVITY_NUM_SAMPLES,
): Map<Id<"nodes">, number> {
  return wasm.compute_sensitivity(nodes, targetNodeId, numSamples) as Map<
    Id<"nodes">,
    number
  >;
}

export { computeMarginalProbabilities, computeSensitivity };

if (typeof self !== "undefined" && "onmessage" in self) {
  self.postMessage({ type: "WORKER_READY" });

  self.onmessage = (event: MessageEvent) => {
    try {
      const message = workerRequestSchema.parse(event.data);

      if (message.type === "COMPUTE_MARGINALS") {
        const probabilities = computeMarginalProbabilities(message.nodes);

        self.postMessage({
          type: "MARGINALS_RESULT",
          requestId: message.requestId,
          probabilities,
        });
      } else if (message.type === "COMPUTE_SENSITIVITY") {
        const sensitivities = computeSensitivity(
          message.nodes,
          message.targetNodeId,
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
