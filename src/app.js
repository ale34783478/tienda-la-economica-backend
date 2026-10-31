import { createServer } from 'node:http';
import { HttpError, Reply, readJson } from './http.js';
import { verifyToken } from './security.js';
import { buildRouter } from './routes.js';

export function createApp({ db, config }) {
  const router = buildRouter({ db, config });

  const corsHeaders = (origin) => {
    const h = { 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' };
    if (config.corsOrigins.includes('*')) h['Access-Control-Allow-Origin'] = '*';
    else if (origin && config.corsOrigins.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h.Vary = 'Origin'; }
    return h;
  };

  function send(res, status, body, extra) {
    const payload = body === null || body === undefined ? null : JSON.stringify(body);
    res.writeHead(status, {
      ...extra,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...(payload !== null && { 'Content-Type': 'application/json; charset=utf-8' }),
    });
    res.end(payload);
  }

  function authenticate(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token && verifyToken(token, config.jwtSecret);
    if (!payload) throw new HttpError(401, 'Sesión no válida o expirada. Inicia sesión de nuevo.', 'UNAUTHORIZED');
    if (db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(payload.jti)) {
      throw new HttpError(401, 'La sesión fue cerrada. Inicia sesión de nuevo.', 'UNAUTHORIZED');
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.active) throw new HttpError(401, 'La cuenta no existe o está desactivada.', 'UNAUTHORIZED');
    return { user, payload };
  }

  return createServer(async (req, res) => {
    const cors = corsHeaders(req.headers.origin);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') return send(res, 204, null, cors);

      const { route, params, pathMatched } = router.match(req.method, url.pathname);
      if (!route) {
        throw pathMatched
          ? new HttpError(405, 'Método no permitido.', 'METHOD_NOT_ALLOWED')
          : new HttpError(404, 'Ruta no encontrada.', 'NOT_FOUND');
      }

      let user = null;
      let auth = null;
      if (route.opts.auth !== false) {
        ({ user, payload: auth } = authenticate(req));
        if (route.opts.roles && !route.opts.roles.includes(user.role)) {
          throw new HttpError(403, 'No tienes permiso para realizar esta acción.', 'FORBIDDEN');
        }
      }

      const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
      const body = hasBody ? await readJson(req) : {};
      const query = Object.fromEntries(url.searchParams);

      const result = await route.handler({ req, params, query, body, user, auth });
      if (result instanceof Reply) return send(res, result.status, result.body, cors);
      return result === null || result === undefined ? send(res, 204, null, cors) : send(res, 200, result, cors);
    } catch (err) {
      if (err instanceof HttpError) {
        return send(res, err.status, { message: err.message, code: err.code, details: err.details ?? null }, cors);
      }
      if (err instanceof URIError) return send(res, 400, { message: 'URL mal formada.', code: 'BAD_URL', details: null }, cors);
      console.error('Error interno:', err);
      return send(res, 500, { message: 'Error interno del servidor.', code: 'INTERNAL_ERROR', details: null }, cors);
    }
  });
}
