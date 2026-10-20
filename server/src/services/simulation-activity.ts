let activeSimulationTicks = 0;

export function beginSimulationTick(): () => void {
  activeSimulationTicks += 1;
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;
    activeSimulationTicks = Math.max(0, activeSimulationTicks - 1);
  };
}

export function getActiveSimulationTicks(): number {
  return activeSimulationTicks;
}

export function isSimulationBusy(): boolean {
  return activeSimulationTicks > 0;
}

let worldEditing = false;

export function beginWorldEdit(): (() => void) | null {
  if (worldEditing) return null;
  worldEditing = true;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    worldEditing = false;
  };
}

export function isWorldEditing(): boolean {
  return worldEditing;
}

export function getSimulationBusyMessage(): string {
  return "Simulation tick is still finishing. Please wait until the world is fully paused.";
}
