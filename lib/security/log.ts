import 'server-only';

/** Deliberately excludes messages, request bodies, identities and provider errors. */
export function securityLog(event: string, fields: {route?: string; status?: number; code?: string} = {}) {
 console.warn(JSON.stringify({event:event.replace(/[^a-z0-9_.-]/gi,'').slice(0,80),
  ...(fields.route ? {route:fields.route.slice(0,100)} : {}),
  ...(fields.status ? {status:fields.status} : {}),
  ...(fields.code ? {code:fields.code.replace(/[^a-z0-9_-]/gi,'').slice(0,60)} : {})}));
}
