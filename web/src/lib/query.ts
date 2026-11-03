import { QueryClient } from "@tanstack/react-query";

/**
 * The app decides by itself when it is offline (see useOnline), including a forced "offline mode",
 * so queries are always allowed to run and screens simply do not ask when there is no connection.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always", retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
    mutations: { networkMode: "always" },
  },
});
