import { db, initialize } from "../../../packages/core/src/db.js";
import { claimJob, renewLease } from "../../../packages/core/src/queue.js";
import { runCycle } from "../../../packages/core/src/runtime.js";
import { terminateSandboxes } from "../../../packages/core/src/sandbox.js";
import { errorText } from "../../../packages/core/src/config.js";
await initialize();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    void terminateSandboxes();
  });
console.log("Benwa worker online. PostgreSQL queue is the source of truth.");
while (!stopping) {
  try {
    await db.creatureState.update({
      where: { id: "benwa" },
      data: { heartbeat: new Date() },
    });
    const job = await claimJob();
    if (job) {
      const heartbeat = setInterval(() => {
        void (async () => {
          await renewLease(job);
          const state = await db.creatureState.findUniqueOrThrow({
            where: { id: "benwa" },
          });
          if (state.status === "STOPPED") await terminateSandboxes();
          await db.creatureState.update({
            where: { id: "benwa" },
            data: { heartbeat: new Date() },
          });
        })().catch((e) => {
          console.error(errorText(e));
          void terminateSandboxes();
        });
      }, 3000);
      try {
        await runCycle(job);
      } finally {
        clearInterval(heartbeat);
      }
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        component: "worker",
        message: errorText(e),
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await terminateSandboxes();
await db.$disconnect();
