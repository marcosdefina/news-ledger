import { openLedger } from "./database.mjs";
import { collectAll } from "./collector.mjs";
import { verifyLedgerBootstrap } from "./bootstrap.mjs";

const command = process.argv[2] ?? "help";
const databasePath = process.env.LEDGER_DB_PATH ?? "/data/news-ledger.db";

function printResults(results) {
  console.log(JSON.stringify(results, null, 2));
  return results.every(({ ok }) => ok);
}

if (command === "init") {
  const database = openLedger({ databasePath });
  database.close();
  console.log(`Initialized ${databasePath}`);
} else if (command === "collect") {
  const database = openLedger({ databasePath });
  try {
    if (!printResults(await collectAll(database))) {
      process.exitCode = 1;
    }
  } finally {
    database.close();
  }
} else if (command === "verify-bootstrap") {
  const database = openLedger({ databasePath, readOnly: true, initialize: false });
  try {
    console.log(JSON.stringify(verifyLedgerBootstrap(database), null, 2));
  } finally {
    database.close();
  }
} else if (command === "loop") {
  const intervalMs = Number.parseInt(process.env.COLLECT_INTERVAL_MS ?? "900000", 10);
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
    throw new Error("COLLECT_INTERVAL_MS must be at least 60000");
  }
  const run = async () => {
    const database = openLedger({ databasePath });
    try {
      printResults(await collectAll(database));
    } finally {
      database.close();
    }
  };
  await run();
  const schedule = () => setTimeout(async () => {
    await run();
    schedule();
  }, intervalMs);
  schedule();
} else {
  console.log("Usage: node src/cli.mjs <init|collect|verify-bootstrap|loop>");
  process.exitCode = command === "help" ? 0 : 2;
}