import { z } from "zod";

// Every env var this app needs, checked once at boot. A later feature that
// needs a new variable adds it here (and to .env.example). See spec 0001.
const Env = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is missing. Copy .env.example to .env and set the Neon pooled URL." })
    .startsWith("postgres", { error: "DATABASE_URL must be a postgres connection string." }),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof Env>;

// Parses process.env, or stops the process with a message naming each bad variable.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = Env.safeParse(source);
  if (!result.success) {
    console.error(`Invalid environment:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}
