/**
 * Request shape the strategy reads credentials from.
 *
 * @packageDocumentation
 */

/**
 * Minimum an incoming HTTP request must provide.
 *
 * Has no index signature: one would make `express.Request` unassignable to
 * this type, which would make `passport.use(new FreeipaStrategy(...))` a
 * compile error. To use a framework's request type in a verify callback,
 * pass it as the strategy's type parameter.
 */
export interface PassportRequest {
  /** Parsed request body. */
  body?: unknown;
  /** Parsed query string. */
  query?: unknown;
  /** Request headers. */
  headers?: Record<string, unknown>;
}
