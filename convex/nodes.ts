import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrCrash } from "./users";

const cptEntryValidator = v.object({
  parentStates: v.record(v.string(), v.boolean()),
  probability: v.number(),
});

export const listByModel = query({
  args: { modelId: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) return [];

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id && !model.isPublic) {
      return [];
    }

    return await ctx.db
      .query("nodes")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
      .collect();
  },
});

export const create = mutation({
  args: {
    modelId: v.id("models"),
    title: v.string(),
    description: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    const nodeId = await ctx.db.insert("nodes", {
      modelId: args.modelId,
      title: args.title,
      description: args.description,
      x: args.x,
      y: args.y,
      cptEntries: [{ parentStates: {}, probability: 0.5 }],
    });

    return nodeId;
  },
});

export const update = mutation({
  args: {
    id: v.id("nodes"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    cptEntries: v.optional(v.array(cptEntryValidator)),
  },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.id);
    if (!node) throw new Error("Node not found");

    const model = await ctx.db.get(node.modelId);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    const updates: Partial<typeof node> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.x !== undefined) updates.x = args.x;
    if (args.y !== undefined) updates.y = args.y;
    if (args.cptEntries !== undefined) updates.cptEntries = args.cptEntries;

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("nodes") },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.id);
    if (!node) throw new Error("Node not found");

    const model = await ctx.db.get(node.modelId);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    const allNodes = await ctx.db
      .query("nodes")
      .withIndex("by_modelId", (q) => q.eq("modelId", node.modelId))
      .collect();

    for (const childNode of allNodes) {
      const parentIds = Object.keys(childNode.cptEntries[0]?.parentStates || {});
      if (parentIds.includes(args.id)) {
        await ctx.db.patch(childNode._id, {
          cptEntries: [{ parentStates: {}, probability: 0.5 }],
        });
      }
    }

    if (model.outputNodeId === args.id) {
      await ctx.db.patch(model._id, { outputNodeId: undefined });
    }

    await ctx.db.delete(args.id);
  },
});
