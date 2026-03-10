import { expect, test } from "bun:test";
import { loadLedger, getLedgerSnapshot } from "../src/ledger";

test("ledger loads with operators and bots", async () => {
  const ledger = await loadLedger();
  expect(ledger).toHaveProperty("operators");
  expect(ledger).toHaveProperty("bots");
});

test("ledger snapshot is a clone", async () => {
  const ledger = await getLedgerSnapshot();
  const copy = await getLedgerSnapshot();
  // Mutate copy and ensure original is unchanged
  const operatorIds = Object.keys(ledger.operators);
  if (operatorIds.length > 0) {
    const id = operatorIds[0];
    copy.operators[id].display_name = "mutated";
    expect(ledger.operators[id].display_name).not.toBe("mutated");
  }
});

