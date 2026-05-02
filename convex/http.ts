import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// Suno webhook — Suno calls back here when a generation finishes.
// Configure SUNO callBackUrl on generate to: <CONVEX_HTTP_URL>/suno/webhook
http.route({
  path: "/suno/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json().catch(() => null);
    if (!body) return new Response("bad json", { status: 400 });

    const taskId = body?.taskId ?? body?.data?.taskId;
    if (!taskId) return new Response("no taskId", { status: 400 });

    const job = await ctx.runQuery(api.jobs.findByTriggerRun, { triggerRunId: `suno:${taskId}` });
    if (!job) {
      console.warn(`suno webhook: no job for taskId ${taskId}`);
      return new Response("no job", { status: 200 });
    }

    const status = String(body?.data?.status ?? body?.status ?? "").toUpperCase();
    if (status.includes("FAIL") || status === "ERROR" || status.includes("SENSITIVE_WORD")) {
      await ctx.runMutation(api.jobs.setFailed, { id: job._id, error: body?.data?.errorMessage ?? status });
      return new Response("ok", { status: 200 });
    }
    // Success path is handled by the Trigger.dev task that polls; webhook is just for early-fail signal.
    return new Response("ok", { status: 200 });
  }),
});

export default http;
