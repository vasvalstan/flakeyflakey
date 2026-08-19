const commands = [
  ["bun", "run", "dev:web"],
  ["bun", "run", "studio"],
] as const;

const children = commands.map((command) => Bun.spawn([...command], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}));

let stopping = false;
async function stop(exitCode: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  await Promise.allSettled(children.map((child) => child.exited));
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void stop(0));
}

const firstExit = await Promise.race(children.map(async (child) => await child.exited));
await stop(firstExit);

export {};
