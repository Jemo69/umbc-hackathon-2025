import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { getOrCreateUser } from "./utils";
import { type Id } from "./_generated/dataModel";

export const getChatHistory = query({
  args: { sessionId: v.optional(v.id("chatSessions")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q: any) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];

    let q = ctx.db
      .query("chatHistory")
      .withIndex("by_userId", (q) => q.eq("userId", user._id));
    if (args.sessionId) {
      q = ctx.db
        .query("chatHistory")
        .withIndex("by_userId_sessionId", (q) =>
          q.eq("userId", user._id).eq("sessionId", args.sessionId!),
        );
    }

    const items = await q.order("desc").take(200);
    return items.reverse();
  },
});

// Clear all messages for a session (keep the session row)
export const clearChatSessionMessages = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id)
      throw new Error("Unauthorized");

    const msgs = await ctx.db
      .query("chatHistory")
      .withIndex("by_userId_sessionId", (q) =>
        q.eq("userId", user._id).eq("sessionId", args.sessionId),
      )
      .collect();
    for (const m of msgs) {
      await ctx.db.delete(m._id);
    }

    // Reset session metadata
    await ctx.db.patch(args.sessionId, {
      lastMessageAt: undefined,
      lastMessagePreview: undefined,
      updatedAt: Date.now(),
    });
  },
});

import { sendChatMessage } from "./ai";

export { sendChatMessage };

// Chat sessions APIs
export const getChatSessions = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q: any) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];
    return await ctx.db
      .query("chatSessions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

// Fetch a session only if it belongs to the current user
export const getSession = query({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q: any) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) return null;
    return session;
  },
});

export const createChatSession = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    const now = Date.now();
    const title = (args.title?.trim() || "New chat").slice(0, 80);
    return await ctx.db.insert("chatSessions", {
      userId: user._id,
      title,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: undefined,
      lastMessagePreview: undefined,
    });
  },
});

export const renameChatSession = mutation({
  args: { sessionId: v.id("chatSessions"), title: v.string() },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id)
      throw new Error("Unauthorized");
    await ctx.db.patch(args.sessionId, {
      title: args.title.slice(0, 80),
      updatedAt: Date.now(),
    });
  },
});

export const deleteChatSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id)
      throw new Error("Unauthorized");

    // Delete all messages in this session
    const msgs = await ctx.db
      .query("chatHistory")
      .withIndex("by_userId_sessionId", (q) =>
        q.eq("userId", user._id).eq("sessionId", args.sessionId),
      )
      .collect();
    for (const m of msgs) {
      await ctx.db.delete(m._id);
    }
    // Delete the session
    await ctx.db.delete(args.sessionId);
  },
});

export const addChatMessage = mutation({
  args: {
    message: v.string(),
    isViewer: v.boolean(),
    sessionId: v.optional(v.id("chatSessions")),
    messageType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("tool_call"),
        v.literal("tool_result"),
      ),
    ),
    toolCalls: v.optional(
      v.array(
        v.object({
          functionName: v.string(),
          arguments: v.string(),
          result: v.optional(v.string()),
        }),
      ),
    ),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);

    await ctx.db.insert("chatHistory", {
      userId: user._id,
      sessionId: args.sessionId,
      message: args.message,
      isViewer: args.isViewer,
      timestamp: Date.now(),
      messageType: args.messageType || "text",
      toolCalls: args.toolCalls,
      context: args.context,
    });
  },
});

export const updateChatSessionMeta = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    lastMessageAt: v.optional(v.number()),
    lastMessagePreview: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id)
      throw new Error("Unauthorized");
    await ctx.db.patch(args.sessionId, {
      updatedAt: Date.now(),
      lastMessageAt: args.lastMessageAt,
      lastMessagePreview: args.lastMessagePreview,
    });
  },
});
