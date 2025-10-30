import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrCrash } from "./users";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type CPTEntry, validateCPTEntries } from "./shared/cptValidation";

const cptEntryValidator = v.object({
  parentStates: v.record(v.id("nodes"), v.union(v.boolean(), v.null())),
  probability: v.number(),
});

function validateCPTEntriesOrThrow(entries: CPTEntry[]): void {
  const result = validateCPTEntries(entries);
  if (!result.valid) {
    throw new ConvexError(result.error);
  }
}

async function isReachableFrom(
  ctx: MutationCtx,
  startNodeId: Id<"nodes">,
  targetNodeId: Id<"nodes">,
  modelId: Id<"models">
): Promise<boolean> {
  const visited = new Set<string>();
  const queue: Id<"nodes">[] = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (visited.has(currentId)) continue;
    visited.add(currentId);

    if (currentId === targetNodeId) {
      return true;
    }

    const currentNode = await ctx.db.get(currentId);
    if (!currentNode || currentNode.modelId !== modelId) continue;

    const parentIds = new Set<string>();
    for (const entry of currentNode.cptEntries) {
      Object.keys(entry.parentStates).forEach(id => parentIds.add(id));
    }

    for (const parentId of parentIds) {
      queue.push(parentId as Id<"nodes">);
    }
  }

  return false;
}

export const listByModel = query({
  args: { modelId: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) return [];

    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      return model.isPublic ? await ctx.db
        .query("nodes")
        .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
        .collect() : [];
    }

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
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
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
    if (!node) throw new ConvexError("Node not found");

    const model = await ctx.db.get(node.modelId);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const updates: Partial<typeof node> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.x !== undefined) updates.x = args.x;
    if (args.y !== undefined) updates.y = args.y;
    if (args.cptEntries !== undefined) {
      validateCPTEntriesOrThrow(args.cptEntries);

      const newParentIds = new Set<string>();
      for (const entry of args.cptEntries) {
        Object.keys(entry.parentStates).forEach(id => newParentIds.add(id));
      }

      if (newParentIds.has(args.id)) {
        throw new ConvexError("Node cannot reference itself as a parent");
      }

      // Get existing parent IDs to only check cycle detection for new parents
      const existingParentIds = new Set<string>();
      for (const entry of node.cptEntries) {
        Object.keys(entry.parentStates).forEach(id => existingParentIds.add(id));
      }

      for (const parentId of newParentIds) {
        const parentNode = await ctx.db.get(parentId as Id<"nodes">);
        if (!parentNode) {
          throw new ConvexError(`Parent node ${parentId} not found`);
        }
        if ("modelId" in parentNode && parentNode.modelId !== node.modelId) {
          throw new ConvexError("Parent nodes must belong to the same model");
        }

        // Only check cycle detection for parents that are actually new
        if (!existingParentIds.has(parentId)) {
          const wouldCreateCycle = await isReachableFrom(
            ctx,
            args.id,
            parentId as Id<"nodes">,
            node.modelId
          );
          if (wouldCreateCycle) {
            throw new ConvexError(
              `Cannot add parent: would create a cycle in the graph. Bayesian networks must be directed acyclic graphs (DAGs).`
            );
          }
        }
      }

      updates.cptEntries = args.cptEntries;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("nodes") },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.id);
    if (!node) throw new ConvexError("Node not found");

    const model = await ctx.db.get(node.modelId);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const allNodes = await ctx.db
      .query("nodes")
      .withIndex("by_modelId", (q) => q.eq("modelId", node.modelId))
      .collect();

    for (const childNode of allNodes) {
      const hasDeletedParent = childNode.cptEntries.some(entry =>
        Object.keys(entry.parentStates).includes(args.id)
      );

      if (hasDeletedParent) {
        const newCptEntries = childNode.cptEntries.map(entry => {
          const newParentStates = { ...entry.parentStates };
          delete newParentStates[args.id];
          return {
            parentStates: newParentStates,
            probability: entry.probability,
          };
        });

        try {
          validateCPTEntriesOrThrow(newCptEntries);
          await ctx.db.patch(childNode._id, {
            cptEntries: newCptEntries,
          });
        } catch (error) {
          console.warn(`CPT validation failed for node ${childNode._id} after parent deletion. Resetting to base probability.`, error);
          await ctx.db.patch(childNode._id, {
            cptEntries: [{ parentStates: {}, probability: 0.5 }],
          });
        }
      }
    }

    if (model.outputNodeId === args.id) {
      await ctx.db.patch(model._id, { outputNodeId: undefined });
    }

    await ctx.db.delete(args.id);
  },
});
