/**
 * Verify callback signatures.
 *
 * @packageDocumentation
 */

import type { FreeipaUser } from "./freeipa";
import type { PassportRequest } from "./request";

/**
 * Reports a verify callback's decision.
 *
 * @param error - An internal error, or `null`.
 * @param user - The authenticated user, or `false` to reject the login.
 * @param info - Info attached to the success or failure.
 */
export type VerifyDone = (
  error: Error | null,
  user?: FreeipaUser | false | null,
  info?: unknown,
) => void;

/**
 * Maps a FreeIPA entry onto an application user, or rejects it.
 *
 * @example
 * ```ts
 * (entry, done) => {
 *   done(null, { id: firstValue(entry, "uid") });
 * }
 * ```
 */
export type VerifyCallback = (user: FreeipaUser, done: VerifyDone) => void;

/**
 * Verify callback used when `passReqToCallback` is `true`.
 *
 * @typeParam TRequest - Framework request type, supplied as the strategy's
 * type parameter to type `request` without an assertion.
 *
 * @example
 * ```ts
 * import type { Request } from "express";
 *
 * new FreeipaStrategy<Request>(
 *   { freeipa: { server }, passReqToCallback: true },
 *   (request, user, done) => {
 *     request.session.lastLogin = Date.now();
 *     done(null, user);
 *   },
 * );
 * ```
 */
export type VerifyCallbackWithRequest<
  TRequest extends PassportRequest = PassportRequest,
> = (request: TRequest, user: FreeipaUser, done: VerifyDone) => void;

/** Either verify callback shape. */
export type AnyVerifyCallback<
  TRequest extends PassportRequest = PassportRequest,
> = VerifyCallback | VerifyCallbackWithRequest<TRequest>;
