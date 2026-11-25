import { insertFeedback, insertUserEvent, syncQuestAwards } from "@kyrox/db";

import { isDemoMode } from "@/lib/demo/mode";
import {
  defaultDemoGrowth,
  readDemoSession,
  writeDemoSession,
  type DemoFeedback,
} from "@/lib/demo/session";
import { appDatabase } from "@/lib/server/database";
import { getSession } from "@/lib/server/session";
import {
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { clientIp } from "@/lib/server/http";
import { readJsonObject, stringField } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const TOPICS = new Set(["bug", "ux", "trading", "documentation", "other"]);

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Sign in to send feedback.", 401, "auth", correlationId);
    if (!rateLimit(`feedback:${session.address}:${clientIp(req)}`, 5)) {
      return error("Too many feedback submissions.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const topic = stringField(body, "topic", { maximumLength: 32 });
    const message = stringField(body, "message", { maximumLength: 2_000 });
    if (!TOPICS.has(topic)) return error("Invalid feedback topic.", 400, "topic", correlationId);
    if (message.trim().length < 10) {
      return error(
        "Feedback must describe the issue in at least 10 characters.",
        400,
        "message",
        correlationId,
      );
    }

    if (isDemoMode()) {
      const demo = await readDemoSession();
      if (demo === null) return error("Sign in to send feedback.", 401, "auth", correlationId);
      const entry: DemoFeedback = {
        topic,
        message: message.trim(),
        createdAt: new Date().toISOString(),
      };
      await writeDemoSession({
        ...demo,
        growth: {
          ...(demo.growth ?? defaultDemoGrowth()),
          feedback: [...(demo.growth?.feedback ?? []), entry].slice(-20),
        },
      });
      return json({ submitted: true, mode: "demo" }, 201);
    }

    const db = appDatabase().db;
    await insertFeedback(db, { address: session.address, topic, message });
    await insertUserEvent(db, {
      address: session.address,
      name: "feedback_submitted",
      props: { topic },
    });
    await syncQuestAwards(db, session.address);
    return json({ submitted: true }, 201);
  } catch (err) {
    return routeError(err, "feedback_unavailable", correlationId);
  }
}
