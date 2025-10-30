import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrCrash } from "./users";
import type { Id } from "./_generated/dataModel";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return [];

    const ownedModels = await ctx.db
      .query("models")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .collect();

    const publicModels = await ctx.db
      .query("models")
      .withIndex("by_isPublic", (q) => q.eq("isPublic", true))
      .collect();

    const ownedModelIds = new Set(ownedModels.map(m => m._id));
    const uniquePublicModels = publicModels.filter(m => !ownedModelIds.has(m._id));
    return [...ownedModels, ...uniquePublicModels];
  },
});

export const get = query({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) return null;

    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      return model.isPublic ? model : null;
    }

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
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const updates: Partial<typeof model> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic;
    if (args.outputNodeId !== undefined) {
      const outputNode = await ctx.db.get(args.outputNodeId);
      if (!outputNode) {
        throw new ConvexError("Output node not found");
      }
      if (outputNode.modelId !== args.id) {
        throw new ConvexError("Output node must belong to this model");
      }
      updates.outputNodeId = args.outputNodeId;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.id))
      .collect();

    for (const node of nodes) {
      await ctx.db.delete(node._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const clone = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id && !model.isPublic) {
      throw new ConvexError("Not authorized");
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
        cptEntries: [{ parentStates: {}, probability: 0.5 }],
      });
      nodeIdMap.set(node._id, newNodeId);
    }

    for (const node of nodes) {
      const newNodeId = nodeIdMap.get(node._id);
      if (!newNodeId) {
        throw new ConvexError(`Failed to find cloned node for ${node._id}`);
      }

      const remappedCptEntries = node.cptEntries.map((entry) => {
        const remappedParentStates: Record<Id<"nodes">, boolean | null> = {};
        for (const [oldParentId, state] of Object.entries(entry.parentStates)) {
          const newParentId = nodeIdMap.get(oldParentId);
          if (!newParentId) {
            throw new ConvexError(`Failed to find cloned parent node for ${oldParentId}`);
          }
          remappedParentStates[newParentId as Id<"nodes">] = state;
        }
        return {
          parentStates: remappedParentStates,
          probability: entry.probability,
        };
      });

      await ctx.db.patch(newNodeId as Id<"nodes">, {
        cptEntries: remappedCptEntries,
      });
    }

    if (model.outputNodeId) {
      const newOutputNodeId = nodeIdMap.get(model.outputNodeId);
      if (newOutputNodeId) {
        await ctx.db.patch(newModelId, {
          outputNodeId: newOutputNodeId as Id<"nodes">,
        });
      }
    }

    return newModelId;
  },
});
