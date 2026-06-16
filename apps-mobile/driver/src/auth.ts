import { expoClient } from "@better-auth/expo/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

// The FleetCo API base URL. A real phone running Expo Go cannot reach the dev
// machine's `localhost`, so the operator points this at their LAN IP (e.g.
// http://192.168.1.20:3001) or an `expo start --tunnel` URL via the
// EXPO_PUBLIC_API_URL env var. Defaults to localhost for an emulator / web.
const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

// better-auth client for the native driver app (ADR-0034). The Expo plugin
// stores the bearer token in expo-secure-store and replays it as
// `Authorization: Bearer <token>` on every request. The server mounts
// better-auth at /auth (basePath), so the client baseURL includes it — matching
// the web client (apps/web/src/lib/auth-client.ts). `fleetco://` is the app's
// deep-link scheme, declared on the CLIENT here (not the server's
// trustedOrigins — a pure-bearer request is not origin-checked, ADR-0034 c2).
// inferAdditionalFields types the RBAC `role` the server attaches to the
// session; this standalone app cannot import the server's auth type, so the
// field shape is declared explicitly (matching auth.ts's additionalFields).
export const authClient = createAuthClient({
  baseURL: `${apiBaseUrl}/auth`,
  plugins: [
    expoClient({
      scheme: "fleetco",
      storagePrefix: "fleetco",
      storage: SecureStore,
    }),
    inferAdditionalFields({
      user: { role: { type: "string" } },
    }),
  ],
});
