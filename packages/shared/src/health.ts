import { z } from "zod";

// Contract for GET /api/health. The API validates what it sends with this
// schema and the web app validates what it receives, so both sides agree.
export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["up", "down"]),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
