// Minimal req/res mocks for invoking api/*.js handlers directly in tests,
// without spinning up a real HTTP server. Handlers are plain (req, res)
// functions (see api/_lib/http.js), so this only needs to fake the small
// surface they actually touch: req.method/headers/query/body and
// res.statusCode/setHeader/end.
export function makeReq({ method = 'GET', headers = {}, query = {}, body } = {}) {
  return { method, headers, query, body: body !== undefined ? JSON.stringify(body) : undefined };
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  return res;
}

export function authHeader(token) {
  return { authorization: `Bearer ${token}` };
}
