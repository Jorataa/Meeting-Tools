import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Report locations and categories only. Credential values never enter output.
const findings = [];
const signatures = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['Supabase secret key', /sb_secret_[0-9A-Za-z_-]{20,}/g],
  ['GitHub credential', /(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{30,})/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['Credential in database URL', /(?:postgres(?:ql)?|mysql):\/\/[^\s:/]+:[^\s@]{8,}@/g],
];
function check(content, location) {
  for (const [kind, expression] of signatures) {
    expression.lastIndex = 0;
    for (const match of content.matchAll(expression)) {
      findings.push({ location, line: content.slice(0, match.index).split('\n').length, kind });
    }
  }
  for (const match of content.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString()).role === 'service_role') findings.push({ location, kind: 'Supabase service role credential' }); } catch { /* Not a JWT. */ }
  }
  if (/NEXT_PUBLIC_(?:GEMINI|SESSION_SECRET|SUPABASE_(?:SERVICE|SECRET)|DATABASE|INTERNAL_TOKEN)/.test(content)) findings.push({ location, kind: 'Secret assigned a browser-public variable name' });
}
const ignored = new Set(['.git', 'node_modules', '.next', '.vercel', 'test-results', 'playwright-report']);
let checked = 0;
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || (entry.name.startsWith('.env') && entry.name !== '.env.example')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|md|sql|ya?ml|txt|example)$/.test(entry.name) && statSync(path).size < 3000000) { check(readFileSync(path, 'utf8'), path); checked++; }
  }
}
scan('.');
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
tracked.filter(path => /(?:^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.env.example')).forEach(location => findings.push({ location, kind: 'Tracked environment file requires review' }));
const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
let historyBlobs = 0;
for (const record of objects) {
  const [oid, ...path] = record.split(' ');
  if (!path.length) continue;
  const type = execFileSync('git', ['cat-file', '-t', oid], { encoding: 'utf8' }).trim();
  if (type !== 'blob') continue;
  const size = Number(execFileSync('git', ['cat-file', '-s', oid], { encoding: 'utf8' }));
  if (size > 3000000) continue;
  check(execFileSync('git', ['cat-file', 'blob', oid], { encoding: 'utf8' }), `history:${path.join(' ')}`); historyBlobs++;
}
// Static client output catches build-time accidental environment inlining.
try { for (const file of readdirSync('.next/static/chunks')) if (file.endsWith('.js')) check(readFileSync(join('.next/static/chunks', file), 'utf8'), `.next/static/chunks/${file}`); } catch { /* Build may not exist yet. */ }
console.log(JSON.stringify({ checkedSourceFiles: checked, checkedHistoryBlobs: historyBlobs, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
