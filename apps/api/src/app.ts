import express from "express";
import { checkDatabase } from "@varroom/db";
import { HealthResponse } from "@varroom/shared";

// Builds the Express app without starting it, so tests can run it on a
// random port. server.ts is the only file that calls listen().
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", async (_req, res) => {
    const database = await checkDatabase();
    const body = HealthResponse.parse({
      status: database === "up" ? "ok" : "degraded",
      database,
      time: new Date().toISOString(),
    });
    res.status(database === "up" ? 200 : 503).json(body);
  });

  return app;
}
