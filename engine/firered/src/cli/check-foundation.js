#!/usr/bin/env node

import {
  loadResearchBundle,
  validateResearchBundle,
} from "../research.js";

try {
  const bundle = await loadResearchBundle(
    new URL("../../research/", import.meta.url),
  );
  const report = validateResearchBundle(bundle);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.structurallyValid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
