import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrCrash } from "./users";

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
      .query("edges")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
      .collect();
  },
});

export const create = mutation({
  args: {
    modelId: v.id("models"),
    parentId: v.id("nodes"),
    childId: v.id("nodes"),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    const parentNode = await ctx.db.get(args.parentId);
    const childNode = await ctx.db.get(args.childId);

    if (!parentNode || !childNode) {
      throw new Error("Parent or child node not found");
    }

    if (parentNode.modelId !== args.modelId || childNode.modelId !== args.modelId) {
      throw new Error("Nodes must belong to the same model");
    }

    const existingEdge = await ctx.db
      .query("edges")
      .withIndex("by_childId", (q) => q.eq("childId", args.childId))
      .filter((q) => q.eq(q.field("parentId"), args.parentId))
      .first();

    if (existingEdge) {
      throw new Error("Edge already exists");
    }

    const edgeId = await ctx.db.insert("edges", {
      modelId: args.modelId,
      parentId: args.parentId,
      childId: args.childId,
    });

    return edgeId;
  },
});

export const remove = mutation({
  args: { id: v.id("edges") },
  handler: async (ctx, args) => {
    const edge = await ctx.db.get(args.id);
    if (!edge) throw new Error("Edge not found");

    const model = await ctx.db.get(edge.modelId);
    if (!model) throw new Error("Model not found");

    const user = await getCurrentUserOrCrash(ctx);
    if (model.ownerId !== user._id) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.id);
  },
});
