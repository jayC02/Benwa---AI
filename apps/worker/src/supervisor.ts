import { db, initialize } from "../../../packages/core/src/db.js";
import { monitor } from "../../../packages/core/src/monitor.js";
import { errorText } from "../../../packages/core/src/config.js";
await initialize();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
console.log(
  "Benwa independent supervisor online. No model provider or execution tools are used.",
);
while (!stopping) {
  try {
    await monitor();
  } catch (e) {
    console.error(
      JSON.stringify({ component: "supervisor", error: errorText(e) }),
    );
  }
  for (let i = 0; i < 10 && !stopping; i++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
}
await db.$disconnect();
