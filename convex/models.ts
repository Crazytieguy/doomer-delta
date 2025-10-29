import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrCrash } from "./users";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrCrash(ctx);
    const ownedModels = await ctx.db
      .query("models")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .collect();

    const publicModels = await ctx.db
      .query("models")
      .filter((q) => q.eq(q.field("isPublic"), true))
      .collect();

    const allModels = [...ownedModels];
    for (const model of publicModels) {
      if (!allModels.find((m) => m._id === model._id)) {
        allModels.push(model);
      }
    }

    return allModels;
  },
});

export const get = query({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) return null;

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id && !model.isPublic) {
      return null;
    }

    return model;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrCrash(ctx);
    const modelId = await ctx.db.insert("models", {
      name: args.name,
      description: args.description,
      ownerId: user._id,
      isPublic: false,
    });
    return modelId;
  },
});

export const update = mutation({
  args: {
    id: v.id("models"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    outputNodeId: v.optional(v.id("nodes")),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    const updates: Partial<typeof model> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic;
    if (args.outputNodeId !== undefined) updates.outputNodeId = args.outputNodeId;

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.id))
      .collect();

    for (const node of nodes) {
      await ctx.db.delete(node._id);
    }

    const edges = await ctx.db
      .query("edges")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.id))
      .collect();

    for (const edge of edges) {
      await ctx.db.delete(edge._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const clone = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id && !model.isPublic) {
      throw new Error("Not authorized");
    }

    const newModelId = await ctx.db.insert("models", {
      name: `${model.name} (Copy)`,
      description: model.description,
      ownerId: user._id,
      isPublic: false,
    });

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.id))
      .collect();

    const nodeIdMap = new Map<string, string>();

    for (const node of nodes) {
      const newNodeId = await ctx.db.insert("nodes", {
        modelId: newModelId,
        title: node.title,
        description: node.description,
        x: node.x,
        y: node.y,
        cptEntries: node.cptEntries,
      });
      nodeIdMap.set(node._id, newNodeId);
    }

    const edges = await ctx.db
      .query("edges")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.id))
      .collect();

    for (const edge of edges) {
      const newParentId = nodeIdMap.get(edge.parentId);
      const newChildId = nodeIdMap.get(edge.childId);
      if (newParentId && newChildId) {
        await ctx.db.insert("edges", {
          modelId: newModelId,
          parentId: newParentId as any,
          childId: newChildId as any,
        });
      }
    }

    if (model.outputNodeId) {
      const newOutputNodeId = nodeIdMap.get(model.outputNodeId);
      if (newOutputNodeId) {
        await ctx.db.patch(newModelId, {
          outputNodeId: newOutputNodeId as any,
        });
      }
    }

    return newModelId;
  },
});
