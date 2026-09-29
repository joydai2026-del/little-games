// Stand-ins for `cloudflare:workers` classes so plain Node tests can build them.
export class DurableObject<E = unknown> {
  constructor(public ctx: DurableObjectState, public env: E) {}
}
export class WorkerEntrypoint<E = unknown> {
  constructor(public ctx: ExecutionContext, public env: E) {}
}
