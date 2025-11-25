import { z } from "zod";
import type { Id } from "../../convex/_generated/dataModel";

const nodeIdSchema = z.custom<Id<"nodes">>((val) => typeof val === "string");

export const nodeSchema = z.object({
  _id: nodeIdSchema,
  cptEntries: z.array(
    z.object({
      parentStates: z.record(z.string(), z.union([z.boolean(), z.null()])),
      probability: z.number(),
    }),
  ),
});

export type WorkerNode = z.infer<typeof nodeSchema>;

export const computeMarginalsRequestSchema = z.object({
  type: z.literal("COMPUTE_MARGINALS"),
  requestId: z.string(),
  nodes: z.array(nodeSchema),
  interventionNodeId: nodeIdSchema.optional(),
});

export const marginalsResultSchema = z.object({
  type: z.literal("MARGINALS_RESULT"),
  requestId: z.string(),
  probabilities: z.instanceof(Map).optional(),
  interventionResult: z
    .object({
      trueCase: z.instanceof(Map),
      falseCase: z.instanceof(Map),
    })
    .optional(),
});

export const errorMessageSchema = z.object({
  type: z.literal("ERROR"),
  requestId: z.string(),
  error: z.string(),
});

export const workerRequestSchema = z.discriminatedUnion("type", [
  computeMarginalsRequestSchema,
]);

export const workerResponseSchema = z.discriminatedUnion("type", [
  marginalsResultSchema,
  errorMessageSchema,
]);

export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export type WorkerResponse = z.infer<typeof workerResponseSchema>;
export type ComputeMarginalsRequest = z.infer<
  typeof computeMarginalsRequestSchema
>;
export type MarginalsResult = z.infer<typeof marginalsResultSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
