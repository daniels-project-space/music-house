/* eslint-disable */
import type * as albums from "../albums.js";
import type * as artists from "../artists.js";
import type * as hearts from "../hearts.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as playlists from "../playlists.js";
import type * as tracks from "../tracks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  albums: typeof albums;
  artists: typeof artists;
  hearts: typeof hearts;
  http: typeof http;
  jobs: typeof jobs;
  playlists: typeof playlists;
  tracks: typeof tracks;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
