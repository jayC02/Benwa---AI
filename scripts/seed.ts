import { db, initialize } from "../packages/core/src/db.js";
await initialize();
console.log(
  "Benwa initialised. No revenue, fabricated projects or activity have been seeded.",
);
await db.$disconnect();
