// test utility to simulate a user session with isolated cookies and IP
// this prevents rate limits and cookie clashing between tests

let ipCounter = 0;

function nextTestIp(): string {
  ipCounter = ipCounter + 1;
  const third = Math.floor(ipCounter / 250);
  const fourth = (ipCounter % 250) + 1;
  return `10.0.${third}.${fourth}`; // 10.0.0.2, 10.0.0.3, ...
}

type CallOptions = {
  method?: string; // defaults to GET without a body, POST with one
  body?: unknown; // sent as JSON
};

export class Fan {
  baseUrl: string;
  ip: string;
  cookies = new Map<string, string>(); // cookie name -> value

  constructor(baseUrl: string, ip: string = nextTestIp()) {
    this.baseUrl = baseUrl;
    this.ip = ip;
  }

  // The same person on another device: same IP, but no cookies yet.
  otherDevice(): Fan {
    return new Fan(this.baseUrl, this.ip);
  }

  // The Cookie header a browser would send, e.g. "a=1; b=2".
  cookieHeader(): string {
    const parts: string[] = [];
    for (const [name, value] of this.cookies) {
      parts.push(`${name}=${value}`);
    }
    return parts.join("; ");
  }

  hasSession(): boolean {
    for (const name of this.cookies.keys()) {
      if (name.includes("session_token")) {
        return true;
      }
    }
    return false;
  }

  // Sends a request like a browser would, and remembers any cookies.
  async call(path: string, options: CallOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      // Better Auth refuses cookie POSTs from other websites (CSRF),
      // so we say the request comes from our own site.
      Origin: this.baseUrl,
      // Where the request "comes from", for the rate limit.
      "X-Forwarded-For": this.ip,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.cookies.size > 0) {
      headers["Cookie"] = this.cookieHeader();
    }

    let method = options.method;
    if (!method) {
      method = options.body === undefined ? "GET" : "POST";
    }

    const response = await fetch(this.baseUrl + path, {
      method: method,
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual", // don't follow redirects, tests check them
    });

    this.rememberCookies(response);
    return response;
  }

  // Reads the Set-Cookie headers of a response and updates our cookies.
  // A Set-Cookie line looks like: "name=value; Path=/; HttpOnly; Max-Age=2592000"
  private rememberCookies(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const parts = line.split(";");
      const nameAndValue = parts[0] ?? "";
      const equalsAt = nameAndValue.indexOf("=");
      const name = nameAndValue.slice(0, equalsAt).trim();
      const value = nameAndValue.slice(equalsAt + 1).trim();

      // The server deletes a cookie by sending it empty or with Max-Age=0.
      const isDeleted = value === "" || line.toLowerCase().includes("max-age=0");
      if (isDeleted) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}

// unique auth details to avoid test collisions
export function newFanDetails() {
  // A random 10 character tag, like "3f9a01bc7d".
  const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return {
    email: `fan.${tag}@test.varroom.dev`,
    password: `pw-${tag}-long`,
    name: `Fan ${tag}`,
    username: `f_${tag}`,
    tag: tag,
  };
}
