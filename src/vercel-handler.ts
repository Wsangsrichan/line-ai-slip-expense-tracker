import { createApp, type AppDependencies } from "./app.js";

export function createVercelHandler(route: string, dependencies: AppDependencies = {}) {
  const app = createApp(dependencies);
  return (request: { url?: string }, response: unknown) => {
    const incomingUrl = request.url ?? "/";
    const queryIndex = incomingUrl.indexOf("?");
    const pathname = queryIndex >= 0 ? incomingUrl.slice(0, queryIndex) : incomingUrl;
    const incomingSegments = pathname.split("/");
    const routeSegments = route.split("/");
    const resolvedRoute = routeSegments.map((segment, index) =>
      segment.startsWith(":") ? incomingSegments[index] ?? "" : segment,
    ).join("/");
    const query = queryIndex >= 0 ? incomingUrl.slice(queryIndex) : "";
    request.url = `${resolvedRoute}${query}`;
    return app(request as never, response as never);
  };
}
