import { ConvexError } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";

export async function getCurrentUserOrNull(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();

  return user;
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUserOrNull(ctx);
  },
});

async function ensureUserExists(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  let user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) {
    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      name: identity.name ?? undefined,
      email: identity.email ?? undefined,
    });
    user = await ctx.db.get(userId);
  } else if (!user.email && identity.email) {
    await ctx.db.patch(user._id, { email: identity.email });
    user = await ctx.db.get(user._id);
  }

  return user;
}

export async function getCurrentUserOrCrash(ctx: QueryCtx | MutationCtx) {
  let user = await getCurrentUserOrNull(ctx);

  if (!user && "db" in ctx && "insert" in ctx.db) {
    user = await ensureUserExists(ctx as MutationCtx);
  }

  if (!user) {
    throw new ConvexError("Not authenticated");
  }

  return user;
}

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    return await ensureUserExists(ctx);
  },
});
