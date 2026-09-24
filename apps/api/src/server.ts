import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();

createApp(env).listen(env.PORT, () => {
  console.log(`VAR Room API listening on http://localhost:${env.PORT}`);
});
