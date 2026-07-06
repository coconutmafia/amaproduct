// Server-error observability (Sentry via lib/sentry — no SDK, see comment there).
// onRequestError fires for every UNCAUGHT server error (API routes, RSC render);
// routes that catch and log their own errors are covered by chain-watch/logs.
import { captureException } from '@/lib/sentry'

export function register() {
  // no-op: nothing to initialize for the lite reporter
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  await captureException(err, {
    path: request.path,
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
  })
}
