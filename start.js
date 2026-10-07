// Production entrypoint for Render and Node.js environments
import { spawn } from "node:child_process";

// If Node 22 was started without --experimental-sqlite (e.g. Render default 'node start')
if (!process.execArgv.includes("--experimental-sqlite")) {
  const child = spawn(
    process.execPath,
    ["--experimental-sqlite", "./dist/index.js", ...process.argv.slice(2)],
    { stdio: "inherit" }
  );

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} else {
  await import("./dist/index.js");
}
