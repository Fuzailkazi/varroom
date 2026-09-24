import { z } from "zod";

// app environment variables - validated at startup
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z
    .string({ error: "DATABASE_URL is missing. Copy .env.example to .env and set the Neon pooled URL." })
    .startsWith("postgres", { error: "DATABASE_URL must be a postgres connection string." }),

  PORT: z.coerce.number().int().positive().default(3000),

  // Sign in.
  BETTER_AUTH_SECRET: z
    .string({ error: "BETTER_AUTH_SECRET is missing. Generate one with `openssl rand -base64 32`." })
    .min(32, { error: "BETTER_AUTH_SECRET must be at least 32 characters." }),
  BETTER_AUTH_URL: z.url({ error: "BETTER_AUTH_URL must be the API's base URL, e.g. http://localhost:3000." }),

  // Only needed in production (see the check below).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

// Reads process.env and returns the checked values.
// If something is wrong, it prints what is wrong and stops the server.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    console.error(`Invalid environment:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }

  const env = result.data;

  // In production emails must really be sent, so the server
  // refuses to start without the email settings. Development prints
  // emails and tests keep them in memory, so they don't need them.
  if (env.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");

    if (missing.length > 0) {
      console.error(`Invalid environment:\n${missing.join(" and ")} must be set in production.`);
      process.exit(1);
    }
  }

  return env;
}
