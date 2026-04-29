import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IS_WINDOWS = process.platform === "win32";
const NPM_CMD = IS_WINDOWS ? "npm.cmd" : "npm";

const procs = [];
let shuttingDown = false;

function run(name, cmd, args, cwd) {
  const proc = spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: IS_WINDOWS,
    detached: !IS_WINDOWS,
  });
  proc.stdout.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => console.log(`[${name}] ${l}`))
  );
  proc.stderr.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => console.error(`[${name}] ${l}`))
  );
  proc.on("exit", (code, signal) => {
    console.log(
      `[${name}] exited (${signal ? `signal ${signal}` : code ?? "unknown"})`,
    );
    if (!shuttingDown) {
      void shutdown(1);
    }
  });
  proc.on("error", (err) => {
    console.error(`[${name}] failed to start: ${err.message}`);
    if (!shuttingDown) {
      void shutdown(1);
    }
  });
  procs.push({ name, proc });
}

run("server", NPM_CMD, ["run", "dev"], join(ROOT, "server"));
run("client", NPM_CMD, ["run", "dev"], join(ROOT, "client"));

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { proc } of procs) {
    terminateProcess(proc, "SIGTERM");
  }

  await sleep(1200);

  for (const { proc } of procs) {
    if (!proc.killed && proc.exitCode == null) {
      terminateProcess(proc, "SIGKILL");
    }
  }

  process.exit(exitCode);
}

function terminateProcess(proc, signal) {
  if (proc.exitCode != null) return;

  try {
    if (!IS_WINDOWS && proc.pid) {
      process.kill(-proc.pid, signal);
      return;
    }
  } catch {
    // Fall through to direct child kill.
  }

  try {
    proc.kill(signal);
  } catch {
    // Ignore already-exited children.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
