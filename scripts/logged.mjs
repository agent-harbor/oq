/** Preserve full subprocess output uniquely while keeping successful runs quiet. */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
const [name, command, ...args] = process.argv.slice(2);
if (!name || !command)
  throw new Error("usage: logged.mjs <name> <command> [args...]");
mkdirSync(".result/logs", { recursive: true });
const path = join(
  ".result/logs",
  `${name}-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.log`,
);
const log = createWriteStream(path);
const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.on("error", (error) => log.write(`${error.stack}\n`));
child.on("close", (code) =>
  log.end(() => {
    if (code === 0) console.log(`${name}: passed (${path})`);
    else
      console.error(
        `${name}: failed; full output: ${path} (${statSync(path).size} bytes)`,
      );
    process.exitCode =
      Number.isInteger(code) && code >= 0 && code < 256 ? code : 1;
  }),
);
