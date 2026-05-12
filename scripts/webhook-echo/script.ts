import type { WorkflowContext } from '../../src/queue-consumer.js';

// `params` for a webhook-triggered run is the entire decoded JSON body of the
// incoming webhook. Trigger detail (e.g. "echo.ping") is on the run row, not
// here. For real webhook handlers, define a TypeScript shape and validate.
export async function run(ctx: WorkflowContext, params?: unknown): Promise<void> {
  ctx.log('info', 'Webhook received', { payload: params });

  // Real webhook scripts would:
  //  - validate the payload shape (TypeScript types alone don't enforce at runtime)
  //  - extract a meaningful key (record ID, event type)
  //  - decide whether to take action or skip
  //  - take action and log what happened

  ctx.log('success', 'Echoed payload to log');
}
