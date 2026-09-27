import { createHash } from "node:crypto";
import { validateTestJob } from "./game-adapters.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function partitionTestPlan(plan, hostId) {
  if (plan?.schema !== "pokemon/test-plan/v1" || !/^[a-zA-Z0-9_-]{1,100}$/.test(plan.id ?? "")) throw new TypeError("invalid fleet plan");
  if (!plan.hosts || !Object.hasOwn(plan.hosts, hostId)) throw new TypeError("unknown fleet host");
  if (!Array.isArray(plan.jobs) || !plan.jobs.length || plan.jobs.length > 1000) throw new TypeError("invalid fleet jobs");
  for (const [name, host] of Object.entries(plan.hosts)) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name) || !host ||
      !Number.isInteger(host.concurrency) || host.concurrency < 1 || host.concurrency > 16 ||
      !Number.isFinite(host.emulationSpeed) || host.emulationSpeed < 1 || host.emulationSpeed > 10 ||
      !Number.isFinite(host.videoFramesPerSecond) || host.videoFramesPerSecond < 1 || host.videoFramesPerSecond > 60 ||
      !Number.isInteger(host.videoPortBase) || host.videoPortBase < 1024 || host.videoPortBase + plan.jobs.filter(j => j.host === name).length > 65536) {
      throw new TypeError(`invalid fleet host settings: ${name}`);
    }
  }
  const ids = new Set();
  for (const job of plan.jobs) {
    if (!/^[a-zA-Z0-9_-]{1,55}$/.test(job.id ?? "") || ids.has(job.id)) throw new TypeError("invalid or duplicate job id");
    ids.add(job.id);
    if (!Object.hasOwn(plan.hosts, job.host)) throw new TypeError(`unknown job host: ${job.host}`);
    validateTestJob(job);
  }
  const jobs = plan.jobs.filter(job => job.host === hostId);
  if (!jobs.length) throw new TypeError("host has no assigned jobs");
  return { id: plan.id, revision: createHash("sha256").update(JSON.stringify(canonical(plan))).digest("hex"),
    hostId, settings: structuredClone(plan.hosts[hostId]), jobs: structuredClone(jobs) };
}
