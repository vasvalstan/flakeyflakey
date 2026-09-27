import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { required, slackChannelId } from "./config";
import { type AgentEvent } from "./policy";
import { enqueue } from "./queue";
import { verifySlack } from "./slack";

const callback = z.object({
  type: z.literal("event_callback"), team_id: z.string(), event_id: z.string(),
  event: z.object({ type: z.string(), channel: z.string().optional(), ts: z.string().optional(),
    thread_ts: z.string().optional(), text: z.string().optional(), user: z.string().optional(),
    bot_id: z.string().optional(), subtype: z.string().optional() }),
});

export function createApp(dispatch: (event: AgentEvent) => Promise<unknown> = enqueue) {
  const app = new Hono();
  app.use("/slack/events", bodyLimit({ maxSize: 100_000 }));
  app.get("/pr-agent/health", c => c.json({ ok: true, service: "flakey-pr-agent" }));
  app.post("/slack/events", async c => {
    const raw = await c.req.text();
    if (!verifySlack(raw, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"), required("SLACK_SIGNING_SECRET"))) {
      return c.json({ error: "Invalid Slack signature" }, 401);
    }
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const challenge = z.object({ type: z.literal("url_verification"), challenge: z.string() }).safeParse(payload);
    if (challenge.success) return c.json({ challenge: challenge.data.challenge });
    const parsed = callback.safeParse(payload);
    if (!parsed.success) return c.json({ ok: true });
    const { event, event_id, team_id } = parsed.data;
    if (team_id !== required("SLACK_TEAM_ID") || event.channel !== slackChannelId ||
        event.type !== "app_mention" || event.bot_id || event.subtype || !event.user || !event.ts) return c.json({ ok: true });
    await dispatch({ kind: "slack", eventId: event_id, teamId: team_id, channelId: slackChannelId,
      threadTs: event.thread_ts ?? event.ts, eventTs: event.ts, text: event.text ?? "", userId: event.user, attempt: 0 });
    return c.json({ ok: true });
  });
  app.onError((_error, c) => c.json({ error: "Unable to accept the job. Slack can retry." }, 503));
  return app;
}
export const app = createApp();
export default app;
