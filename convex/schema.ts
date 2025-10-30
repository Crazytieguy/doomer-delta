import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.optional(v.string()),
  }).index("by_clerkId", ["clerkId"]),

  models: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    outputNodeId: v.optional(v.id("nodes")),
    isPublic: v.boolean(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_isPublic", ["isPublic"]),

  nodes: defineTable({
    modelId: v.id("models"),
    title: v.string(),
    description: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    cptEntries: v.array(
      v.object({
        parentStates: v.record(v.id("nodes"), v.union(v.boolean(), v.null())),
        probability: v.number(),
      }),
    ),
    columnOrder: v.optional(v.array(v.id("nodes"))),
  }).index("by_modelId", ["modelId"]),
});
