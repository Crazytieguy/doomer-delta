import { z } from "zod";
import type { Id } from "../../convex/_generated/dataModel";

const nodeIdSchema = z.custom<Id<"nodes">>((val) => typeof val === "string");

export const nodeSchema = z.object({
  _id: nodeIdSchema,
  cptEntries: z.array(
    z.object({
      parentStates: z.record(z.string(), z.union([z.boolean(), z.null()])),
      probability: z.number(),
    })
  ),
});

export type WorkerNode = z.infer<typeof nodeSchema>;

export const computeMarginalsRequestSchema = z.object({
  type: z.literal("COMPUTE_MARGINALS"),
  requestId: z.string(),
  nodes: z.array(nodeSchema),
});

export const computeSensitivityRequestSchema = z.object({
  type: z.literal("COMPUTE_SENSITIVITY"),
  requestId: z.string(),
  nodes: z.array(nodeSchema),
  targetNodeId: nodeIdSchema,
});

export const marginalsResultSchema = z.object({
  type: z.literal("MARGINALS_RESULT"),
  requestId: z.string(),
  probabilities: z.instanceof(Map),
});

export const sensitivityCompleteSchema = z.object({
  type: z.literal("SENSITIVITY_COMPLETE"),
  requestId: z.string(),
  sensitivities: z.instanceof(Map),
});

export const errorMessageSchema = z.object({
  type: z.literal("ERROR"),
  requestId: z.string(),
  error: z.string(),
});

export const workerRequestSchema = z.discriminatedUnion("type", [
  computeMarginalsRequestSchema,
  computeSensitivityRequestSchema,
]);

export const workerResponseSchema = z.discriminatedUnion("type", [
  marginalsResultSchema,
  sensitivityCompleteSchema,
  errorMessageSchema,
]);

export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export type WorkerResponse = z.infer<typeof workerResponseSchema>;
export type ComputeMarginalsRequest = z.infer<typeof computeMarginalsRequestSchema>;
export type ComputeSensitivityRequest = z.infer<typeof computeSensitivityRequestSchema>;
export type MarginalsResult = z.infer<typeof marginalsResultSchema>;
export type SensitivityComplete = z.infer<typeof sensitivityCompleteSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
