/**
 * FreeIPA connection settings and result shapes.
 *
 * @packageDocumentation
 */

/** Connection settings for a FreeIPA server. */
export interface FreeipaOptions {
  /**
   * Hostname or origin of the server. A bare hostname is upgraded to
   * `https://`.
   *
   * @example "ipa.example.com"
   * @example "https://ipa.example.com:8443"
   */
  server: string;

  /**
   * API version sent with each JSON-RPC call. Pin this when targeting a
   * server older than the client.
   *
   * @defaultValue "2.156"
   */
  clientVersion?: string;

  /**
   * Milliseconds before a request to the server is aborted.
   *
   * @defaultValue 10000
   */
  timeout?: number;

  /**
   * `fetch` implementation used for every request. Supply one backed by a
   * custom `undici` dispatcher to trust an internal CA.
   *
   * @defaultValue `globalThis.fetch`
   *
   * @example
   * ```ts
   * import { Agent } from "undici";
   *
   * const agent = new Agent({ connect: { ca: internalCa } });
   * const options = {
   *   server: "ipa.example.com",
   *   fetch: (input, init) => fetch(input, { ...init, dispatcher: agent }),
   * };
   * ```
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * A user entry returned by `user_show`.
 *
 * Values are LDAP attributes, so most arrive as arrays even when single
 * valued. Read them with `firstValue` or `allValues`.
 *
 * @example
 * ```json
 * { "uid": ["jdoe"], "mail": ["jdoe@example.com"], "nsaccountlock": false }
 * ```
 */
export type FreeipaUser = Record<string, unknown>;
