import { z } from "zod";

// shared schema for the /api/health endpoint
export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["up", "down"]),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
