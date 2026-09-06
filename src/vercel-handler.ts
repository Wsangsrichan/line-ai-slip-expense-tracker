import { createApp, type AppDependencies } from "./app.js";

type VercelRequestLike = {
  url?: string;
  query?: Record<string, string | string[] | undefined>;
};

export function createVercelHandler(route: string, dependencies: AppDependencies = {}) {
  const app = createApp(dependencies);
  return (request: VercelRequestLike, response: unknown) => {
    const incomingUrl = request.url ?? "/";
    const queryIndex = incomingUrl.indexOf("?");
    const pathname = queryIndex >= 0 ? incomingUrl.slice(0, queryIndex) : incomingUrl;
    const incomingSegments = pathname.split("/").filter(Boolean);
    const routeSegments = route.split("/").filter(Boolean);
    const resolvedRoute = routeSegments.map((segment, index) => {
      if (!segment.startsWith(":")) return segment;
      const queryValue = request.query?.[segment.slice(1)];
      if (typeof queryValue === "string") return queryValue;
      if (Array.isArray(queryValue) && queryValue.length > 0) return queryValue[0];
      // Vercel normally includes the complete pathname, but some adapters pass
      // only the function-relative path. In that case the dynamic value is the
      // final incoming segment rather than the route's absolute index.
      const routePrefix = routeSegments.slice(0, index);
      const hasRoutePrefix = routePrefix.every((value, prefixIndex) => incomingSegments[prefixIndex] === value);
      return hasRoutePrefix ? incomingSegments[index] ?? "" : incomingSegments[incomingSegments.length - 1] ?? "";
    }).join("/");
    const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
    request.url = `/${resolvedRoute}${query}`;
    return app(request as never, response as never);
  };
}
