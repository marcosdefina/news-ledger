import assert from "node:assert/strict";
import test from "node:test";

import { SOURCES, sourceById } from "../src/sources.mjs";

test("initial source register is stable, active, and rights-aware", () => {
  assert.deepEqual(
    SOURCES.map(({ id }) => id),
    ["guardian-uk", "bbc-england", "irish-times", "rte-news"],
  );
  assert.deepEqual(new Set(SOURCES.map(({ countryCode }) => countryCode)), new Set(["GB", "IE"]));

  for (const source of SOURCES) {
    assert.equal(source.active, true);
    assert.equal(new URL(source.feedUrl).protocol, "https:");
    assert.equal(new URL(source.termsUrl).protocol, "https:");
    assert.equal(source.capturePolicy, "official-feed-private-evidence");
    assert.equal(source.publicContentPolicy, "metadata-and-excerpt");
  }
});

test("sourceById rejects unknown source identifiers", () => {
  assert.equal(sourceById("irish-times")?.name, "The Irish Times");
  assert.equal(sourceById("unknown"), null);
});