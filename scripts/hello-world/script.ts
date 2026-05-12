import type { WorkflowContext } from '../../src/queue-consumer.js';

export interface HelloWorldParams {
  dry_run?: boolean;
  name?: string;
}

// The minimum a script needs to be:
// 1. Export `run(ctx, params)`.
// 2. Use `ctx.log(type, message, optionalDetail)` for everything — never console.log.
// 3. Throw to fail the run (the queue consumer catches, marks failed, and emails).
// 4. Return normally to succeed.
export async function run(ctx: WorkflowContext, params?: HelloWorldParams): Promise<void> {
  const dryRun = params?.dry_run ?? true;
  const name = params?.name?.trim() || 'world';

  ctx.log('info', `Hello, ${name}! (dry_run=${dryRun})`);

  if (!dryRun) {
    // For real scripts: do the actual work here. The "dry run" branch above
    // should log what *would* happen, so you can preview before going live.
    ctx.log('info', 'No side effects in hello-world — but a real script would do work here.');
  }

  ctx.log('success', 'Done.');
}
