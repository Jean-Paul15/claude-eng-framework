/** Attente synchrone sans consommer de CPU (les hooks et la CLI sont synchrones). */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
