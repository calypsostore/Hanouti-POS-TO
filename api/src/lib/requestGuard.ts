export function createLatestRequestGuard() {
  let generation = 0;
  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    isLatest(candidate: number): boolean {
      return candidate === generation;
    },
  };
}

export function createSubmissionGate() {
  let active = false;
  return {
    async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (active) return undefined;
      active = true;
      try {
        return await operation();
      } finally {
        active = false;
      }
    },
  };
}
