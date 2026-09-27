import { rm } from "node:fs/promises";

// Test fixtures can leave background pollers writing into their temporary
// directory while the cleanup hook runs, which makes a plain recursive rm race
// with the writer and fail with ENOTEMPTY. Retry those races deterministically.
export async function removeTempDirectory(root, { attempts = 20, delayMs = 50 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["ENOTEMPTY", "EBUSY"].includes(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  await rm(root, { recursive: true, force: true });
}
