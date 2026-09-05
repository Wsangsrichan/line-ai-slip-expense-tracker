import { createApp } from "./app.js";

export function createVercelHandler(route: string) {
  const app = createApp();
  return (request: { url?: string }, response: unknown) => {
    const query = request.url?.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
    request.url = `${route}${query}`;
    return app(request as never, response as never);
  };
}
