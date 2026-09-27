import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { recoverInterruptedReviews } from "./reviews/runner.ts";

const env = loadEnv();

// reviews the last process was running were cut off. fail them before taking requests
await recoverInterruptedReviews();

createApp(env).listen(env.PORT, () => {
  console.log(`VAR Room API listening on http://localhost:${env.PORT}`);
});
