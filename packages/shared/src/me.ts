import { z } from "zod";

// schema for the /api/me user profile endpoint
export const MeResponse = z.object({
  id: z.string(),
  username: z.string(), // lowercase, unique ignoring case
  displayUsername: z.string(), // as the fan typed it at sign up
  displayName: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  role: z.enum(["USER", "ADMIN"]),
  badge: z.enum(["SPECTATOR", "ASSISTANT_REF", "CHIEF_VAR"]),
  tacticalIqScore: z.number().int(),
  joinedAt: z.iso.datetime(),
});

export type MeResponse = z.infer<typeof MeResponse>;
