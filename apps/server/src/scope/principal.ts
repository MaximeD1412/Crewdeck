/**
 * Who a request comes from, set on the request by the auth layer before
 * `ScopeGuard` runs: CORE-4 for the session cookie (`pilot`), RUNNER-2 for
 * the Runner's token (`runner`). Both act within one Pilote's scope.
 */
export interface Principal {
  readonly kind: 'pilot' | 'runner';
  readonly pilotId: string;
}

/** The request as the scope reads it. */
export interface PrincipalRequest {
  principal?: Principal;
}
