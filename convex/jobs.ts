import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { renderWorkerTokenDigest, verifyRenderMutationProof } from "../src/lib/render-session";
import { requireRenderIdentity } from "./renderAuth";

async function requireWorker(job: {ownerSubject?: string; workerTokenSha256?: string} | null, token?: string) {
  if (!job?.ownerSubject) return; // Already queued legacy jobs retain their worker path.
  if (!token || !job.workerTokenSha256 || await renderWorkerTokenDigest(token) !== job.workerTokenSha256) throw new Error("Trusted render worker required");
}

export const list = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("running"), v.literal("complete"), v.literal("failed"))) },
  handler: async (ctx, { status }) => {
    const rows = status ? await ctx.db.query("generationJobs").withIndex("by_status", (q) => q.eq("status", status)).collect() : await ctx.db.query("generationJobs").collect();
    return rows.filter(job => job.ownerSubject === undefined);
  },
});

export const get = query({
  args: { id: v.id("generationJobs") },
  handler: async (ctx, { id }) => { const job = await ctx.db.get(id); return job?.ownerSubject === undefined ? job : null; },
});

export const create = mutation({
  args: {
    generator: v.union(v.literal("suno"), v.literal("mureka"), v.literal("minimax")),
    artistSlug: v.optional(v.string()),
    albumSlug: v.optional(v.string()),
    prompt: v.string(),
    lyrics: v.optional(v.string()),
    referenceUrl: v.optional(v.string()),
    config: v.any(),
    sessionToken: v.string(),
    workerTokenSha256: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, ...args }) => {
    const identity = await requireRenderIdentity(sessionToken);
    if (args.config && typeof args.config === "object" && "engine" in args.config) throw new Error("Engine binding requires trusted server admission");
    if (args.generator !== "minimax" && !/^[a-f0-9]{64}$/.test(args.workerTokenSha256 ?? "")) throw new Error("Render worker capability required");
    return ctx.db.insert("generationJobs", { ...args, ownerSubject: identity.subject, status: "pending", createdAt: Date.now() });
  },
});

export const setRunning = mutation({
  args: { id: v.id("generationJobs"), triggerRunId: v.optional(v.string()), workerToken: v.optional(v.string()) },
  handler: async (ctx, { id, triggerRunId, workerToken }) => {
    const job = await ctx.db.get(id);
    if (job?.generator === "minimax" && job.ownerSubject) throw new Error("Native Music3 state requires verified engine readback");
    await requireWorker(job, workerToken);
    await ctx.db.patch(id, { status: "running", triggerRunId });
  },
});

export const setComplete = mutation({
  args: { id: v.id("generationJobs"), resultTrackIds: v.array(v.id("tracks")), workerToken: v.optional(v.string()) },
  handler: async (ctx, { id, resultTrackIds, workerToken }) => {
    const job = await ctx.db.get(id);
    if (job?.generator === "minimax" && job.ownerSubject) throw new Error("Native Music3 completion requires verified engine readback");
    await requireWorker(job, workerToken);
    await ctx.db.patch(id, { status: "complete", resultTrackIds, completedAt: Date.now() });
  },
});

export const setFailed = mutation({
  args: { id: v.id("generationJobs"), error: v.string(), workerToken: v.optional(v.string()), sessionToken: v.optional(v.string()), serverProof: v.optional(v.string()) },
  handler: async (ctx, { id, error, sessionToken, serverProof, workerToken }) => {
    const job = await ctx.db.get(id);
    if (job?.generator === "minimax" && job.ownerSubject) {
      const identity = await requireRenderIdentity(sessionToken);
      if (identity.subject !== job.ownerSubject || !await verifyRenderMutationProof(serverProof, "fail-engine", identity.subject, { id, error }, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET)) throw new Error("Trusted render failure required");
    }
    if (job?.generator !== "minimax") await requireWorker(job, workerToken);
    await ctx.db.patch(id, { status: "failed", error, completedAt: Date.now() });
  },
});

export const findByTriggerRun = query({
  args: { triggerRunId: v.string() },
  handler: async (ctx, { triggerRunId }) => {
    const job = await ctx.db.query("generationJobs").withIndex("by_trigger_run", (q) => q.eq("triggerRunId", triggerRunId)).first();
    return job?.ownerSubject ? null : job; // Owned jobs use authenticated worker polling.
  },
});

/** Persist the verified engine admission without claiming an audio result. */
export const setEngineBinding = mutation({
  args: { id: v.id("generationJobs"), sessionToken: v.string(), serverProof: v.string(), binding: v.object({ jobId: v.string(), state: v.string(), manifestSha256: v.string(),
    output: v.object({ bucket: v.string(), key: v.string(), receiptKey: v.string() }) }) },
  handler: async (ctx, { id, binding, sessionToken, serverProof }) => {
    const identity = await requireRenderIdentity(sessionToken);
    if (!await verifyRenderMutationProof(serverProof, "bind-engine", identity.subject, { id, binding }, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET)) throw new Error("Trusted render admission required");
    const job = await ctx.db.get(id);
    if (!job || job.generator !== "minimax" || job.ownerSubject !== identity.subject || job.status !== "pending" || job.config?.engine) throw new Error("Music3 job binding changed");
    await ctx.db.patch(id, { config: { ...job.config, engine: binding } });
  },
});
export const syncEngineState = mutation({
  args: { id: v.id("generationJobs"), sessionToken: v.string(), serverProof: v.string(), engineJobId: v.string(), state: v.string() },
  handler: async (ctx, { id, engineJobId, state, sessionToken, serverProof }) => {
    const identity = await requireRenderIdentity(sessionToken);
    if (!await verifyRenderMutationProof(serverProof, "sync-engine", identity.subject, { id, engineJobId, state }, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET)) throw new Error("Trusted render readback required");
    const job = await ctx.db.get(id);
    if (!job || job.generator !== "minimax" || job.ownerSubject !== identity.subject || job.config?.engine?.jobId !== engineJobId || ["complete", "failed"].includes(job.status)) return;
    const status = state === "completed" ? "complete" : ["failed", "cancelled"].includes(state) ? "failed" :
      ["launching", "running", "shutdown-requested"].includes(state) ? "running" : "pending";
    await ctx.db.patch(id, { status, config: { ...job.config, engine: { ...job.config.engine, state } },
      ...(status === "complete" || status === "failed" ? { completedAt: Date.now() } : {}),
      ...(status === "failed" ? { error: `Music3 engine job ${state}` } : {}) });
  },
});

/** Unowned legacy jobs are never adopted through a browser-controlled ID. */
export const getOwned = query({
  args: { id: v.id("generationJobs"), sessionToken: v.string() },
  handler: async (ctx, { id, sessionToken }) => {
    const identity = await requireRenderIdentity(sessionToken);
    const job = await ctx.db.get(id);
    return job?.ownerSubject === identity.subject ? job : null;
  },
});

export const listOwned = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const identity = await requireRenderIdentity(sessionToken);
    return ctx.db.query("generationJobs").withIndex("by_owner", q => q.eq("ownerSubject", identity.subject)).order("desc").take(100);
  },
});

/** Validate task admission before any provider request. Legacy queued tasks remain valid. */
export const authorizeWorker = query({
  args: { id: v.id("generationJobs"), workerToken: v.optional(v.string()) },
  handler: async (ctx, { id, workerToken }) => {
    const job = await ctx.db.get(id);
    if (!job || (job.generator === "minimax" && job.ownerSubject)) throw new Error("Invalid render worker job");
    await requireWorker(job, workerToken);
    return true;
  },
});
