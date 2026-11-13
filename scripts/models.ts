import { db, initialize } from "../packages/core/src/db.js";
import { verifyModels } from "../packages/core/src/gemini/verify.js";
const probe = process.argv.includes("--probe");
const selected = process.argv
  .find((a) => a.startsWith("--models="))
  ?.slice(9)
  .split(",");
try {
  await initialize();
  console.log(
    JSON.stringify(
      await verifyModels(
        probe,
        selected,
        undefined,
        process.argv.includes("--experimental"),
      ),
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : "Model verification failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
