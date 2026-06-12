import { tasks } from "@trigger.dev/sdk/v3";
import type { distrokidAnalytics } from "../../../../trigger/distrokid-analytics";

export const runtime = "nodejs";

// Kicks off a READ-ONLY DistroKid analytics pull (streams + balance). The
// distribution page subscribes to distributorAnalytics.latest, so the strip
// updates live when the task writes its snapshot.
export async function POST() {
  const handle = await tasks.trigger<typeof distrokidAnalytics>("distrokid-analytics", {});
  return Response.json({ runId: handle.id });
}
