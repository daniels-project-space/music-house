/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as albums from "../albums.js";
import type * as artists from "../artists.js";
import type * as distribution from "../distribution.js";
import type * as distributorAnalytics from "../distributorAnalytics.js";
import type * as distributorAuth from "../distributorAuth.js";
import type * as hearts from "../hearts.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as playlists from "../playlists.js";
import type * as savedLyrics from "../savedLyrics.js";
import type * as tracks from "../tracks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  albums: typeof albums;
  artists: typeof artists;
  distribution: typeof distribution;
  distributorAnalytics: typeof distributorAnalytics;
  distributorAuth: typeof distributorAuth;
  hearts: typeof hearts;
  http: typeof http;
  jobs: typeof jobs;
  playlists: typeof playlists;
  savedLyrics: typeof savedLyrics;
  tracks: typeof tracks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
