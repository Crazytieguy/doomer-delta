import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { getCurrentUserOrNull, getCurrentUserOrCrash } from "./users";
import type { Id, Doc } from "./_generated/dataModel";
import { syncColumnOrderWithCptEntries } from "./shared/cptValidation";

function getUserDisplayName(user: Doc<"users"> | null): string {
  return user?.name ?? user?.email ?? "Unknown";
}

export const listMyModels = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return [];

    return await ctx.db
      .query("models")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
  },
});

export const listPublic = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("models")
      .withIndex("by_isPublic_uniqueForkers", (q) => q.eq("isPublic", true))
      .order("desc")
      .paginate(args.paginationOpts);

    const modelsWithOwners = await Promise.all(
      results.page.map(async (model) => {
        const owner = await ctx.db.get(model.ownerId);
        return {
          ...model,
          ownerName: getUserDisplayName(owner),
        };
      }),
    );

    return {
      ...results,
      page: modelsWithOwners,
    };
  },
});

export const listPublicInitial = query({
  args: {},
  handler: async (ctx) => {
    const models = await ctx.db
      .query("models")
      .withIndex("by_isPublic_uniqueForkers", (q) => q.eq("isPublic", true))
      .order("desc")
      .take(12);

    const modelsWithOwners = await Promise.all(
      models.map(async (model) => {
        const owner = await ctx.db.get(model.ownerId);
        return {
          ...model,
          ownerName: getUserDisplayName(owner),
        };
      }),
    );

    return modelsWithOwners;
  },
});

export const get = query({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) return null;

    const owner = await ctx.db.get(model.ownerId);
    const ownerName = getUserDisplayName(owner);

    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      return model.isPublic ? { ...model, isOwner: false, ownerName } : null;
    }

    const isOwner = model.ownerId === user._id;
    if (isOwner || model.isPublic) {
      return { ...model, isOwner, ownerName };
    }

    const share = await ctx.db
      .query("modelShares")
      .withIndex("by_modelId_userId", (q) =>
        q.eq("modelId", args.id).eq("userId", user._id),
      )
      .unique();

    if (share) {
      return { ...model, isOwner: false, ownerName };
    }

    return null;
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
      uniqueForkers: 0,
    });
    return modelId;
  },
});

export const update = mutation({
  args: {
    id: v.id("models"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
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

export const togglePublic = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    await ctx.db.patch(args.id, { isPublic: !model.isPublic });
    return !model.isPublic;
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

    const shares = await ctx.db
      .query("modelShares")
      .withIndex("by_modelId_userId", (q) => q.eq("modelId", args.id))
      .collect();

    for (const share of shares) {
      await ctx.db.delete(share._id);
    }

    if (model.forkedFrom) {
      const parent = await ctx.db.get(model.forkedFrom);
      if (parent) {
        const otherForksFromSameUser = await ctx.db
          .query("models")
          .withIndex("by_ownerId", (q) => q.eq("ownerId", model.ownerId))
          .filter((q) =>
            q.and(
              q.eq(q.field("forkedFrom"), model.forkedFrom),
              q.neq(q.field("_id"), args.id),
            ),
          )
          .first();

        if (!otherForksFromSameUser && model.ownerId !== parent.ownerId) {
          await ctx.db.patch(model.forkedFrom, {
            uniqueForkers: Math.max(0, (parent.uniqueForkers ?? 0) - 1),
          });
        }
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const fork = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.id);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    const isOwner = model.ownerId === user._id;

    if (!isOwner && !model.isPublic) {
      const share = await ctx.db
        .query("modelShares")
        .withIndex("by_modelId_userId", (q) =>
          q.eq("modelId", args.id).eq("userId", user._id),
        )
        .unique();

      if (!share) {
        throw new ConvexError("Not authorized");
      }
    }

    const existingFork = await ctx.db
      .query("models")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.eq(q.field("forkedFrom"), args.id))
      .first();

    const newModelId = await ctx.db.insert("models", {
      name: `${model.name} (Copy)`,
      description: model.description,
      ownerId: user._id,
      isPublic: false,
      forkedFrom: args.id,
      uniqueForkers: 0,
    });

    if (!isOwner && !existingFork) {
      await ctx.db.patch(args.id, {
        uniqueForkers: (model.uniqueForkers ?? 0) + 1,
      });
    }

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
            throw new ConvexError(
              `Failed to find cloned parent node for ${oldParentId}`,
            );
          }
          remappedParentStates[newParentId as Id<"nodes">] = state;
        }
        return {
          parentStates: remappedParentStates,
          probability: entry.probability,
        };
      });

      const remappedColumnOrder = node.columnOrder?.map((oldParentId) => {
        const newParentId = nodeIdMap.get(oldParentId);
        if (!newParentId) {
          throw new ConvexError(
            `Failed to find cloned parent node for columnOrder: ${oldParentId}`,
          );
        }
        return newParentId as Id<"nodes">;
      });

      await ctx.db.patch(newNodeId as Id<"nodes">, {
        cptEntries: remappedCptEntries,
        columnOrder:
          remappedColumnOrder ||
          syncColumnOrderWithCptEntries(remappedCptEntries, undefined),
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

export const share = mutation({
  args: {
    modelId: v.id("models"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!targetUser) {
      throw new ConvexError("User not found");
    }

    if (targetUser._id === user._id) {
      throw new ConvexError("Cannot share model with yourself");
    }

    const existingShare = await ctx.db
      .query("modelShares")
      .withIndex("by_modelId_userId", (q) =>
        q.eq("modelId", args.modelId).eq("userId", targetUser._id),
      )
      .unique();

    if (existingShare) {
      throw new ConvexError("Model already shared with this user");
    }

    await ctx.db.insert("modelShares", {
      modelId: args.modelId,
      userId: targetUser._id,
    });
  },
});

export const unshare = mutation({
  args: {
    modelId: v.id("models"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) throw new ConvexError("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    const share = await ctx.db
      .query("modelShares")
      .withIndex("by_modelId_userId", (q) =>
        q.eq("modelId", args.modelId).eq("userId", args.userId),
      )
      .unique();

    if (!share) {
      throw new ConvexError("Share not found");
    }

    await ctx.db.delete(share._id);
  },
});

export const listSharedUsers = query({
  args: { modelId: v.id("models") },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) return [];

    const user = await getCurrentUserOrNull(ctx);
    if (!user || model.ownerId !== user._id) {
      return [];
    }

    const shares = await ctx.db
      .query("modelShares")
      .withIndex("by_modelId_userId", (q) => q.eq("modelId", args.modelId))
      .collect();

    const sharedUsers = await Promise.all(
      shares.map(async (share) => {
        const sharedUser = await ctx.db.get(share.userId);
        return {
          _id: share.userId,
          name: getUserDisplayName(sharedUser),
          email: sharedUser?.email ?? "",
        };
      }),
    );

    return sharedUsers;
  },
});

export const listSharedWithMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return [];

    const shares = await ctx.db
      .query("modelShares")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const models = await Promise.all(
      shares.map(async (share) => {
        const model = await ctx.db.get(share.modelId);
        if (!model || model.isPublic) return null;

        const owner = await ctx.db.get(model.ownerId);
        return {
          ...model,
          ownerName: getUserDisplayName(owner),
        };
      }),
    );

    return models.filter((m) => m !== null);
  },
});
