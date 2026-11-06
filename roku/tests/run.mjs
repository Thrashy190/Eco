// Runs each tests/*_test.brs with the pure helpers in components/lib, in the brs-node interpreter (no TV needed).
// A test prints "FAIL ..." for each failed check and "PASS <name>" at the end; brs-cli always exits 0, so the
// output decides.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Only the files with no SceneGraph in them: api.brs reads m.global, which only exists on a TV
const libs = ["queue.brs", "format.brs"].map((f) => join(root, "components", "lib", f));
const cli = join(root, "node_modules", ".bin", "brs-cli");

let failed = false;
for (const test of readdirSync(join(root, "tests")).filter((f) => f.endsWith("_test.brs")).sort()) {
  let out;
  try {
    out = execFileSync(cli, [...libs, join(root, "tests", test)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}FAIL ${test} did not run`;
  }
  const lines = out.split("\n").filter((l) => !l.startsWith("------"));
  const ok = lines.some((l) => l.startsWith("PASS")) && !lines.some((l) => l.includes("FAIL") || /error/i.test(l));
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${test}\n`);
  if (!ok) {
    failed = true;
    process.stdout.write(lines.join("\n") + "\n");
  }
}
process.exit(failed ? 1 : 0);
