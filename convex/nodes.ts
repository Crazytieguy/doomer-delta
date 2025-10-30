import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrCrash } from "./users";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

const cptEntryValidator = v.object({
  parentStates: v.record(v.id("nodes"), v.union(v.boolean(), v.null())),
  probability: v.number(),
});

type CPTEntry = {
  parentStates: Record<string, boolean | null>;
  probability: number;
};

function expandEntry(entry: CPTEntry, parentIds: string[]): string[] {
  const nullIndices: number[] = [];
  const baseValues: (boolean | null)[] = [];

  for (let i = 0; i < parentIds.length; i++) {
    const val = entry.parentStates[parentIds[i]];
    baseValues.push(val);
    if (val === null) {
      nullIndices.push(i);
    }
  }

  const numExpansions = Math.pow(2, nullIndices.length);
  const combinations: string[] = [];

  for (let i = 0; i < numExpansions; i++) {
    const values = [...baseValues];
    for (let j = 0; j < nullIndices.length; j++) {
      values[nullIndices[j]] = Boolean((i >> j) & 1);
    }
    const key = values.map(v => v ? 'T' : 'F').join('');
    combinations.push(key);
  }

  return combinations;
}

function validateCPTEntries(entries: CPTEntry[]): void {
  if (entries.length === 0) {
    throw new ConvexError("CPT entries cannot be empty");
  }

  const parentIds = Object.keys(entries[0]?.parentStates || {});

  for (const entry of entries) {
    if (isNaN(entry.probability) || entry.probability < 0 || entry.probability > 1) {
      throw new ConvexError(`Invalid probability value: ${entry.probability}. Must be between 0 and 1.`);
    }

    const entryParentIds = Object.keys(entry.parentStates);
    if (entryParentIds.length !== parentIds.length || !entryParentIds.every(id => parentIds.includes(id))) {
      throw new ConvexError("All CPT entries must have the same parent nodes");
    }
  }

  if (parentIds.length === 0) {
    return;
  }

  const coverageCount = new Map<string, number>();

  for (const entry of entries) {
    const combinations = expandEntry(entry, parentIds);
    for (const combo of combinations) {
      coverageCount.set(combo, (coverageCount.get(combo) || 0) + 1);
    }
  }

  const numCombinations = Math.pow(2, parentIds.length);
  const uncovered: string[] = [];
  const multiCovered: string[] = [];

  for (let i = 0; i < numCombinations; i++) {
    const key = parentIds.map((_, idx) => Boolean((i >> idx) & 1) ? 'T' : 'F').join('');
    const count = coverageCount.get(key) || 0;

    if (count === 0) {
      uncovered.push(key);
    } else if (count > 1) {
      multiCovered.push(key);
    }
  }

  if (uncovered.length > 0) {
    throw new ConvexError(
      `CPT is incomplete: ${uncovered.length} of ${numCombinations} combinations not covered. Missing: ${uncovered.slice(0, 3).join(', ')}${uncovered.length > 3 ? '...' : ''}`
    );
  }

  if (multiCovered.length > 0) {
    throw new ConvexError(
      `CPT has conflicts: ${multiCovered.length} combinations covered by multiple rules. Conflicting: ${multiCovered.slice(0, 3).join(', ')}${multiCovered.length > 3 ? '...' : ''}`
    );
  }
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
      validateCPTEntries(args.cptEntries);

      const parentIds = new Set<string>();
      for (const entry of args.cptEntries) {
        Object.keys(entry.parentStates).forEach(id => parentIds.add(id));
      }

      if (parentIds.has(args.id)) {
        throw new ConvexError("Node cannot reference itself as a parent");
      }

      for (const parentId of parentIds) {
        const parentNode = await ctx.db.get(parentId as Id<"nodes">);
        if (!parentNode) {
          throw new ConvexError(`Parent node ${parentId} not found`);
        }
        if ("modelId" in parentNode && parentNode.modelId !== node.modelId) {
          throw new ConvexError("Parent nodes must belong to the same model");
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
          validateCPTEntries(newCptEntries);
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
