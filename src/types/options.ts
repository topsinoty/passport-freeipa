/**
 * Strategy and per-request options.
 *
 * @packageDocumentation
 */

import type { FreeipaOptions } from "./freeipa";

/** Options forwarded from `passport.authenticate("freeipa", ...)`. */
export interface AuthenticateOptions {
  /**
   * Challenge message used when the request carries no credentials.
   *
   * @defaultValue "Missing credentials."
   */
  badRequestMessage?: string;
  [option: string]: unknown;
}

/** Options common to both verify callback shapes. */
export interface BaseStrategyOptions {
  /** FreeIPA connection settings. */
  freeipa: FreeipaOptions;

  /**
   * Field holding the username, read from the body then the query string.
   * Supports bracket paths such as `"user[name]"`.
   *
   * @defaultValue "username"
   */
  usernameField?: string;

  /**
   * Field holding the password.
   *
   * @defaultValue "password"
   */
  passwordField?: string;
}

/** Options paired with a `(user, done)` verify callback. */
export interface StrategyOptionsWithoutRequest extends BaseStrategyOptions {
  /**
   * Pass the request as the verify callback's first argument.
   *
   * @defaultValue false
   */
  passReqToCallback?: false;
}

/**
 * Options paired with a `(request, user, done)` verify callback.
 *
 * Separate from {@link StrategyOptionsWithoutRequest} so the constructor
 * overloads reject a mismatched callback at compile time.
 */
export interface StrategyOptionsWithRequest extends BaseStrategyOptions {
  /** Pass the request as the verify callback's first argument. */
  passReqToCallback: true;
}

/** Options accepted by the strategy constructor. */
export type StrategyOptions =
  StrategyOptionsWithoutRequest | StrategyOptionsWithRequest;
