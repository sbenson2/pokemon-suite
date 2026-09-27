#!/usr/bin/env node
import { createCampaignViewer } from "../presentation/campaign-viewer.js";
import { readFile } from "node:fs/promises";

const [suiteDirectory, flag, port] = process.argv.slice(2);
if (!suiteDirectory || suiteDirectory === "--help") {
  process.stdout.write("Usage: node src/cli/serve-campaign-viewer.js SUITE_PATH [--port 17439]\n");
  if (!suiteDirectory) process.exitCode = 1;
} else if ((flag && flag !== "--port") || (flag && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535))) {
  process.stderr.write("Invalid viewer port\n"); process.exitCode = 1;
} else {
  try {
    const tokenPath = process.env.MASTER_RED_STOP_REPORT_TOKEN_FILE;
    const stopReportToken = tokenPath ? (await readFile(tokenPath, "utf8")).trim() : null;
    if (tokenPath && !stopReportToken) throw new Error("empty stop-report token file");
    const viewer = await createCampaignViewer({ suiteDirectory, port: Number(port ?? 17439), stopReportToken });
    process.stdout.write(`${JSON.stringify({ event: "campaign-viewer-ready", url: viewer.url })}\n`);
    const stop = () => { viewer.close().then(() => process.exit(0), () => process.exit(1)); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  } catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
}
