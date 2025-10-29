import { QueryCtx, MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

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
    });
    user = await ctx.db.get(userId);
  }

  return user;
}

export async function getCurrentUserOrCrash(ctx: QueryCtx | MutationCtx) {
  let user = await getCurrentUserOrNull(ctx);

  if (!user && "db" in ctx && "insert" in (ctx as any).db) {
    user = await ensureUserExists(ctx as MutationCtx);
  }

  if (!user) {
    throw new ConvexError("Not authenticated");
  }

  return user;
}
