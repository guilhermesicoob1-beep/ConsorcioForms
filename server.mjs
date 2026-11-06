import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const { CRM_USER, CRM_PASSWORD, SUPABASE_SERVER_KEY, PORT = 3000 } = process.env;
if (!CRM_USER || !CRM_PASSWORD || !SUPABASE_SERVER_KEY) {
  throw new Error('Configure CRM_USER, CRM_PASSWORD e SUPABASE_SERVER_KEY.');
}

const database = 'https://jgnkdtklmhbhfyqrzolw.supabase.co/rest/v1/consorcio_leads';
const page = await readFile(new URL('./index.html', import.meta.url));
const sessions = new Map();
const attempts = new Map();
const sessionAge = 8 * 60 * 60;
const digest = value => createHash('sha256').update(String(value ?? '')).digest();
const matches = (value, expected) => timingSafeEqual(digest(value), digest(expected));

setInterval(() => {
  for (const entries of [sessions, attempts]) {
    for (const [key, item] of entries) {
      if ((item.expires ?? item) <= Date.now()) entries.delete(key);
    }
  }
}, 60_000).unref();

createServer(async (req, res) => {
  const reply = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data === undefined ? undefined : JSON.stringify(data));
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    const method = req.method;
    const token = (req.headers.cookie || '').match(/(?:^|; )crm_session=([a-f0-9]+)/)?.[1];
    const active = sessions.get(token) > Date.now();
    const secure = process.env.CRM_SECURE_COOKIE === '1' ? '; Secure' : '';
    const cookie = (value, age) => 'crm_session=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + secure;
    const readJson = async () => {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw new Error('invalid body');
      }
      return JSON.parse(body);
    };

    if (method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(page);
    }

    if (url.pathname === '/api/session') {
      if (method === 'GET') return reply(200, { active });
      if (method === 'DELETE') {
        sessions.delete(token);
        res.setHeader('Set-Cookie', cookie('', 0));
        return reply(204);
      }
      if (method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { message: 'Formato inválido.' });
        const address = req.socket.remoteAddress;
        const now = Date.now();
        const limit = attempts.get(address);
        if (limit?.expires > now && limit.count >= 10) return reply(429, { message: 'Aguarde alguns minutos antes de tentar novamente.' });
        const credentials = await readJson();
        const validUser = matches(credentials.username, CRM_USER);
        const validPassword = matches(credentials.password, CRM_PASSWORD);
        if (!validUser || !validPassword) {
          const current = attempts.get(address);
          attempts.set(address, current?.expires > now
            ? { ...current, count: current.count + 1 }
            : { count: 1, expires: now + 5 * 60_000 });
          return reply(401, { message: 'Usuário ou senha inválidos.' });
        }
        attempts.delete(address);
        sessions.delete(token);
        const newToken = randomBytes(32).toString('hex');
        sessions.set(newToken, now + sessionAge * 1000);
        res.setHeader('Set-Cookie', cookie(newToken, sessionAge));
        return reply(204);
      }
    }

    if (url.pathname === '/api/leads' && ['GET', 'PATCH'].includes(method)) {
      if (!active) return reply(401, { message: 'Sessão expirada. Entre novamente.' });
      const headers = { apikey: SUPABASE_SERVER_KEY, 'Content-Type': 'application/json' };
      if (!SUPABASE_SERVER_KEY.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + SUPABASE_SERVER_KEY;
      let query = '?select=*&order=created_at.desc&limit=1000';
      let body;
      if (method === 'PATCH') {
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { message: 'Formato inválido.' });
        const id = url.searchParams.get('id');
        const { status } = await readJson();
        if (!id || !/^[a-z0-9-]+$/i.test(id) || !['Novo', 'Em atendimento', 'Fechado'].includes(status)) {
          return reply(400, { message: 'Lead ou status inválido.' });
        }
        query = '?id=eq.' + encodeURIComponent(id);
        body = JSON.stringify({ status });
        headers.Prefer = 'return=minimal';
      }
      const result = await fetch(database + query, { method, headers, body });
      if (!result.ok) return reply(502, { message: 'O banco de dados recusou a operação.' });
      if (method === 'PATCH') return reply(204);
      return reply(200, await result.json());
    }
    return reply(404, { message: 'Página não encontrada.' });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error.message === 'invalid body';
    return reply(invalid ? 400 : 502, { message: invalid ? 'Dados inválidos.' : 'Não foi possível concluir a operação.' });
  }
}).listen(Number(PORT), () => console.log('CRM disponível na porta ' + PORT));
