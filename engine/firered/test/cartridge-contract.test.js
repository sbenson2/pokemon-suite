import assert from "node:assert/strict";
import test from "node:test";

import { qualifyCartridge } from "../src/foundation.js";

const profile = {
  qualification: {
    id: "firered-rev1-stock",
    bytes: 16_777_216,
    sha1: "dd5945db9b930750cb39d00c84da8571feebf417",
  },
  compatibility: [
    {
      id: "adventure-edition-derived",
      bytes: 16_777_216,
      sha1: "119a7d55c88abcd2af723fee970595ec0cc97d8e",
    },
  ],
};

test("only the pinned stock cartridge may produce qualification evidence", () => {
  assert.deepEqual(
    qualifyCartridge(profile, {
      bytes: 16_777_216,
      sha1: "dd5945db9b930750cb39d00c84da8571feebf417",
    }),
    { tier: "qualification", cartridgeId: "firered-rev1-stock" },
  );

  assert.deepEqual(
    qualifyCartridge(profile, {
      bytes: 16_777_216,
      sha1: "119a7d55c88abcd2af723fee970595ec0cc97d8e",
    }),
    { tier: "compatibility-only", cartridgeId: "adventure-edition-derived" },
  );

  assert.deepEqual(
    qualifyCartridge(profile, { bytes: 1, sha1: "unknown" }),
    { tier: "unsupported", cartridgeId: null },
  );
});
