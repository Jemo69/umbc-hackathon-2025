import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { getOrCreateUser } from "./utils";
import { type Id } from "./_generated/dataModel";

// Helper: get or create the current authenticated user
async function getOrCreateCurrentUser(ctx: any): Promise<any> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  // If running in a query/mutation context (has db), use direct DB access
  if (ctx.db) {
    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q: any) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (user) return user;

    const newUser: any = { tokenIdentifier: identity.tokenIdentifier };
    if (identity.name) newUser.name = identity.name;
    if (identity.email) newUser.email = identity.email;
    const userId = await ctx.db.insert("users", newUser);
    return await ctx.db.get(userId);
  }

  // If running in an action context (no db), use runMutation/runQuery
  if (ctx.runQuery && ctx.runMutation) {
    await ctx.runMutation(api.users.store);
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) {
      throw new Error("User not found after store");
    }
    return user;
  }

  throw new Error("Unsupported context for getOrCreateCurrentUser");
}

// AI response generation with OpenRouter or OpenAI
async function generateAIResponse(userMessage: string, ctx: any) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const hasAI = !!openRouterKey || !!openAIApiKey;
  if (!hasAI) {
    return {
      message:
        "No AI API key configured. Set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY to enable AI responses.",
      messageType: "text" as const,
      toolCalls: undefined,
      context: userMessage,
    };
  }

  // basic system prompt tailored to this app
  const systemPrompt =
    "you are edutron, an ai study assistant. be concise and helpful. you can suggest creating tasks or notes. keep responses student-friendly.";

  // 1) lightweight intent detection for tool calls (no api call needed)
  const msg = userMessage.toLowerCase();
  if (
    msg.includes("add task") ||
    msg.includes("create task") ||
    msg.includes("remind me") ||
    msg.includes("make a task") ||
    msg.includes("new task") ||
    msg.includes("todo") ||
    msg.includes("to-do") ||
    msg.includes("assignment") ||
    msg.includes("homework") ||
    (msg.includes("add") && msg.includes("task"))
  ) {
    const taskTitle = extractTaskTitle(userMessage);
    const dueDate = extractDueDate(userMessage);
    const toolCalls = [
      {
        functionName: "addTask",
        arguments: JSON.stringify({
          title: taskTitle,
          dueDate: dueDate,
          estimatedTime: 60,
          context: userMessage,
        }),
      },
    ];

    return {
      message: `i've added "${taskTitle}" to your task list${
        dueDate
          ? ` with a due date of ${new Date(dueDate).toLocaleDateString()}`
          : ""
      }. want to set a subject or priority?`,
      messageType: "tool_call" as const,
      toolCalls,
      context: userMessage,
    };
  }

  if (
    msg.includes("save") ||
    msg.includes("note") ||
    msg.includes("remember")
  ) {
    const noteTitle = extractNoteTitle(userMessage);
    const noteContent = extractNoteContent(userMessage);
    const toolCalls = [
      {
        functionName: "addNote",
        arguments: JSON.stringify({
          title: noteTitle,
          content: noteContent,
          context: userMessage,
        }),
      },
    ];

    return {
      message: `saved a note titled "${noteTitle}".`,
      messageType: "tool_call" as const,
      toolCalls,
      context: userMessage,
    };
  }

  // Time management and scheduling intent
  if (
    msg.includes("plan my day") ||
    msg.includes("plan my time") ||
    msg.includes("schedule") ||
    msg.includes("time management") ||
    msg.includes("study plan") ||
    msg.includes("focus plan") ||
    msg.includes("pomodoro")
  ) {
    const availableMinutes = extractAvailableMinutes(userMessage) ?? 120;
    const startTime = Date.now();
    const toolCalls = [
      {
        functionName: "planTime",
        arguments: JSON.stringify({
          availableMinutes,
          startTime,
          context: userMessage,
        }),
      },
    ];
    return {
      message: `i've drafted a ${Math.round(
        availableMinutes
      )} minute study plan starting now. want to adjust the start time or subjects?`,
      messageType: "tool_call" as const,
      toolCalls,
      context: userMessage,
    };
  }

  // 2) otherwise, call openai for a general helpful response
  try {
    const useOpenRouter = !!openRouterKey;
    const model = useOpenRouter
      ? process.env.CHAT_MODEL || "x-ai/grok-4-fast:free"
      : process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

    const url = useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${useOpenRouter ? openRouterKey : openAIApiKey}`,
    };
    // optional but recommended for openrouter:
    if (useOpenRouter) {
      headers["http-referer"] =
        process.env.SITE_URL || process.env.site_url || "http://localhost";
      headers["x-title"] =
        process.env.SITE_NAME || process.env.site_name || "edutron";
    }

    const res = await fetch(url, {
      method: "post",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.5,
      }),
    });

    if (!res.ok) {
      throw new Error(`openai error ${res.status}`);
    }
    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      "i'm here to help with your studies!";

    return {
      message: content,
      messageType: "text" as const,
      toolCalls: undefined,
      context: userMessage,
    };
  } catch (err) {
    return {
      message:
        "I had trouble contacting the AI service. Please try again in a moment.",
      messageType: "text" as const,
      toolCalls: undefined,
      context: userMessage,
    };
  }
}

// Helper functions for text extraction
function extractTaskTitle(message: string): string {
  // Simple extraction - in production, use more sophisticated NLP
  const words = message.split(" ");
  const taskWords = words.filter(
    (word) =>
      !["add", "create", "task", "remind", "me", "to", "about"].includes(
        word.toLowerCase(),
      ),
  );
  return taskWords.join(" ") || "New Task";
}

function extractDueDate(message: string): number | undefined {
  // Simple date extraction - in production, use a proper date parser
  if (message.includes("tomorrow")) {
    return Date.now() + 24 * 60 * 60 * 1000;
  }
  if (message.includes("next week")) {
    return Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  // Add more date parsing logic
  return undefined;
}

function extractNoteTitle(message: string): string {
  const words = message.split(" ");
  const noteWords = words.filter(
    (word) =>
      !["save", "note", "remember", "that"].includes(word.toLowerCase()),
  );
  return noteWords.slice(0, 5).join(" ") || "New Note";
}

function extractNoteContent(message: string): string {
  return message; // In production, extract more meaningful content
}

function extractAvailableMinutes(message: string): number | undefined {
  // look for patterns like "2 hours", "90 minutes", or just a number + h/m
  const lower = message.toLowerCase();
  const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|h)\b/);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    if (!isNaN(hours)) return Math.round(hours * 60);
  }
  const minMatch = lower.match(/(\d+)\s*(minute|minutes|min|mins|m)\b/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    if (!isNaN(mins)) return mins;
  }
  // fallback: a bare number might mean minutes if followed by nothing obvious
  const bare = lower.match(/\b(\d{2,3})\b/);
  if (bare) {
    const mins = parseInt(bare[1], 10);
    if (!isNaN(mins)) return mins;
  }
  return undefined;
}

export const sendChatMessage: any = action({
  args: { message: v.string(), sessionId: v.optional(v.id("chatSessions")) },
  handler: async (ctx, args) => {
    const user = await getOrCreateCurrentUser(ctx);

    // Ensure a session exists (auto-create if not provided)
    let sessionId = args.sessionId;
    // If a sessionId was provided, verify ownership; otherwise ignore it
    if (sessionId) {
      const owned = await ctx.runQuery(api.chat.getSession, { sessionId });
      if (!owned) {
        sessionId = undefined;
      }
    }
    if (!sessionId) {
      const preview = args.message.slice(0, 60);
      sessionId = await ctx.runMutation(api.chat.createChatSession, {
        title: preview,
      });
    }

    // Add user message to chat history
    await ctx.runMutation(api.chat.addChatMessage, {
      message: args.message,
      isViewer: true,
      sessionId,
      messageType: "text",
    });

    // Generate AI response using OpenAI
    const aiResponse = await generateAIResponse(args.message, ctx);

    // Add AI response to chat history
    await ctx.runMutation(api.chat.addChatMessage, {
      message: aiResponse.message,
      isViewer: false,
      sessionId,
      messageType: aiResponse.messageType,
      toolCalls: aiResponse.toolCalls,
      context: aiResponse.context,
    });

    // If AI requested tool calls, execute them on the server and store results
    if (
      aiResponse.messageType === "tool_call" &&
      aiResponse.toolCalls?.length
    ) {
      for (const tool of aiResponse.toolCalls) {
        try {
          const parsed = JSON.parse(tool.arguments || "{}");
          let result: any = null;
          if (tool.functionName === "addTask") {
            result = await ctx.runMutation(api.todos.createTask, {
              title: parsed.title || "New Task",
              description: parsed.description,
              dueDate: parsed.dueDate,
              estimatedEffort: parsed.estimatedTime,
              subject: parsed.subject,
              priorityScore: parsed.priority,
              documentRef: parsed.documentRef,
              context: parsed.context,
              isGeneratedByAI: true,
            });
          } else if (tool.functionName === "addNote") {
            result = await ctx.runMutation(api.notes.createNote, {
              title: parsed.title || "New Note",
              content: parsed.content || parsed.context || "",
              subject: parsed.subject,
              tags: parsed.tags || [],
              documentRef: parsed.documentRef,
              context: parsed.context,
            });
          } else if (tool.functionName === "planTime") {
            // Generate a simple time-blocked plan from current tasks
            const availableMinutes =
              Number(parsed.availableMinutes) > 0 ? Number(parsed.availableMinutes) : 120;
            const startTime =
              typeof parsed.startTime === "number" ? parsed.startTime : Date.now();

            const tasks = await ctx.runQuery(api.todos.getTasks, {
              completed: false,
              sortByDueDate: true,
            });

            // Rank tasks: sooner due dates first, then higher priority, then longer remaining effort
            const ranked = [...tasks].sort((a: any, b: any) => {
              const dueA = a.dueDate ?? Infinity;
              const dueB = b.dueDate ?? Infinity;
              if (dueA !== dueB) return dueA - dueB;
              const prA = a.priorityScore ?? 0;
              const prB = b.priorityScore ?? 0;
              if (prA !== prB) return prB - prA;
              const effA = a.estimatedEffort ?? 30;
              const effB = b.estimatedEffort ?? 30;
              return effB - effA;
            });

            // Build plan with 45m focus blocks and 10m breaks
            const plan: any[] = [];
            let cursor = startTime;
            let minutesLeft = availableMinutes;

            for (const t of ranked) {
              if (minutesLeft <= 0) break;
              let effort = Math.max(15, Math.min(120, t.estimatedEffort ?? 45));
              while (effort > 0 && minutesLeft > 0) {
                const block = Math.min(45, effort, minutesLeft);
                plan.push({
                  type: "focus",
                  taskId: t._id,
                  title: t.title,
                  subject: t.subject,
                  start: cursor,
                  end: cursor + block * 60_000,
                  minutes: block,
                });
                cursor += block * 60_000;
                minutesLeft -= block;
                effort -= block;

                // Add a 10m break if time remains and still working
                if (effort > 0 && minutesLeft > 0) {
                  const breakMin = Math.min(10, minutesLeft);
                  plan.push({
                    type: "break",
                    start: cursor,
                    end: cursor + breakMin * 60_000,
                    minutes: breakMin,
                  });
                  cursor += breakMin * 60_000;
                  minutesLeft -= breakMin;
                }
              }
            }

            result = { plan, summary: `Planned ${availableMinutes - minutesLeft} of ${availableMinutes} minutes.` };
          }

          // Store tool_result message
          let displayMessage =
            result
              ? `Tool ${tool.functionName} executed successfully.`
              : `Tool ${tool.functionName} executed.`;
          if (tool.functionName === "planTime" && (result as any)?.plan?.length) {
            const lines = (result as any).plan
              .map((b: any) => {
                const start = new Date(b.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const end = new Date(b.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                if (b.type === "focus") {
                  return `${start}-${end}: Focus on "${b.title}" (${b.subject || "General"}) for ${b.minutes}m`;
                }
                return `${start}-${end}: Break (${b.minutes}m)`;
              })
              .join("\n");
            displayMessage = `Here is your time-blocked plan:\n${lines}`;
          }
          await ctx.runMutation(api.chat.addChatMessage, {
            message: displayMessage,
            isViewer: false,
            sessionId,
            messageType: "tool_result",
            toolCalls: [
              {
                functionName: tool.functionName,
                arguments: JSON.stringify(parsed),
                result: JSON.stringify(result ?? {}),
              },
            ],
            context: aiResponse.context,
          });
        } catch (e: any) {
          await ctx.runMutation(api.chat.addChatMessage, {
            message: `Tool ${tool.functionName} failed: ${e?.message || e}`,
            isViewer: false,
            sessionId,
            messageType: "tool_result",
            toolCalls: [
              {
                functionName: tool.functionName,
                arguments: tool.arguments || "{}",
                result: JSON.stringify({ error: true }),
              },
            ],
            context: aiResponse.context,
          });
        }
      }
    }

    // Update chat session metadata
    const now = Date.now();
    await ctx.runMutation(api.chat.updateChatSessionMeta, {
      sessionId: sessionId!,
      lastMessageAt: now,
      lastMessagePreview: aiResponse.message.slice(0, 120),
    });

    return { ...aiResponse, sessionId };
  },
});

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
