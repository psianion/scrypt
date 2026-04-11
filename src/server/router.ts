// src/server/router.ts
type Handler = (
  req: Request,
  params: Record<string, string>
) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    // *param captures rest-of-path, :param captures a single segment
    const regexStr = path
      .replace(/\*(\w+)/g, (_, name) => {
        paramNames.push(name);
        return "(.+)";
      })
      .replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      });
    this.routes.push({
      method,
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
    });
  }

  get(path: string, handler: Handler) { this.add("GET", path, handler); }
  post(path: string, handler: Handler) { this.add("POST", path, handler); }
  put(path: string, handler: Handler) { this.add("PUT", path, handler); }
  delete(path: string, handler: Handler) { this.add("DELETE", path, handler); }

  handle(req: Request): Response | Promise<Response> | null {
    const url = new URL(req.url);
    for (const route of this.routes) {
      if (req.method !== route.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return route.handler(req, params);
    }
    return null;
  }
}
