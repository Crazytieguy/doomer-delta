import type { Id } from "../../convex/_generated/dataModel";
import { workerRequestSchema, type WorkerNode } from "../types/workerMessages";
import * as wasm from "../../wasm-inference/pkg";

const NUM_SAMPLES = 1_000_000;

function computeMarginalProbabilities(
  nodes: WorkerNode[],
  interventionNodeId: Id<"nodes"> | undefined,
  numSamples: number = NUM_SAMPLES,
):
  | Map<Id<"nodes">, number>
  | { trueCase: Map<Id<"nodes">, number>; falseCase: Map<Id<"nodes">, number> } {
  if (nodes.length === 0) return new Map();
  if (numSamples <= 0) throw new Error("numSamples must be positive");

  return wasm.compute_marginals(nodes, numSamples, interventionNodeId) as
    | Map<Id<"nodes">, number>
    | {
        trueCase: Map<Id<"nodes">, number>;
        falseCase: Map<Id<"nodes">, number>;
      };
}

export { computeMarginalProbabilities };

if (typeof self !== "undefined" && "onmessage" in self) {
  self.postMessage({ type: "WORKER_READY" });

  self.onmessage = (event: MessageEvent) => {
    try {
      const message = workerRequestSchema.parse(event.data);

      if (message.type === "COMPUTE_MARGINALS") {
        const result = computeMarginalProbabilities(
          message.nodes,
          message.interventionNodeId,
        );

        if (result instanceof Map) {
          self.postMessage({
            type: "MARGINALS_RESULT",
            requestId: message.requestId,
            probabilities: result,
          });
        } else {
          self.postMessage({
            type: "MARGINALS_RESULT",
            requestId: message.requestId,
            interventionResult: result,
          });
        }
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
