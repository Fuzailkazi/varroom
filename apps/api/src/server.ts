import { setupTracing } from "@varroom/agents";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { runStartupJobs } from "./startup.ts";

const env = loadEnv();

// sends ADK's traces to Langfuse, only when both Langfuse keys are set. never throws
setupTracing(process.env);

// fail the reviews the last process left running, then delete call rows older
// than 48 hours now and every hour after
await runStartupJobs();

createApp(env).listen(env.PORT, () => {
  console.log(`VAR Room API listening on http://localhost:${env.PORT}`);
});
