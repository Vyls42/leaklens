// A local OpenAI-compatible stub that serves recorded model answers (fixtures/judge-recorded.json). No model is called.
// Each request is matched to a task by its issue text and to a check by its system prompt.
import http from 'node:http';
import fs from 'node:fs';
import { SYSTEM_1, SYSTEM_2, SYSTEM_3 } from '../src/prompts.mjs';

const recorded = JSON.parse(fs.readFileSync(new URL('../fixtures/judge-recorded.json', import.meta.url), 'utf8')).tasks;
const fixture = fs.readFileSync(new URL('../fixtures/swe-bench-verified-10.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

// opts.blankAnswers: every answer has no rationale (BEN-620). opts.failAfter: answer HTTP 500 to every request after the first n. opts.rejectSchema: answer 400 to json_schema.
export function startStub(opts = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: 'not found' });
      const b = JSON.parse(body);
      requests.push({ headers: req.headers, body: b });
      if (opts.failAfter !== undefined && requests.length > opts.failAfter) return send(500, { error: 'stub: planned failure' });
      if (opts.rejectSchema && b.response_format && b.response_format.type === 'json_schema') return send(400, { error: { message: 'response_format json_schema is not supported' } });
      const sys = b.messages[0].content;
      const user = b.messages[1].content;
      const run = sys === SYSTEM_1 ? 0 : sys === SYSTEM_2 ? 1 : sys === SYSTEM_3 ? 2 : -1;
      const task = fixture.find((t) => user.includes(t.problem_statement.slice(0, 400)));
      if (run < 0 || !task) return send(400, { error: 'stub: unknown prompt' });
      const ans = recorded[task.instance_id].runs[run];
      if (!ans) return send(400, { error: `stub: no recorded check ${run + 1} for ${task.instance_id}` });
      // BEN-620: opts.blankAnswers answers every check with a reply that carries no verdict
      if (opts.blankAnswers) return send(200, { choices: [{ message: { role: 'assistant', content: '{"tier":"none","quotes":[]}' } }] });
      const content = opts.wrapInProse ? 'Here is my answer:\n```json\n' + JSON.stringify(ans) + '\n```' : JSON.stringify(ans);
      send(200, { choices: [{ message: { role: 'assistant', content } }] });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((r) => server.close(r)) });
  }));
}
