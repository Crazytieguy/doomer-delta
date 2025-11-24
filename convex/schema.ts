import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"]),

  models: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    outputNodeId: v.optional(v.id("nodes")),
    isPublic: v.boolean(),
    forkedFrom: v.optional(v.id("models")),
    uniqueForkers: v.optional(v.number()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_isPublic_uniqueForkers", ["isPublic", "uniqueForkers"]),

  nodes: defineTable({
    modelId: v.id("models"),
    forkedFrom: v.optional(v.id("nodes")),
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

  modelShares: defineTable({
    modelId: v.id("models"),
    userId: v.id("users"),
  })
    .index("by_modelId_userId", ["modelId", "userId"])
    .index("by_userId", ["userId"]),
});
