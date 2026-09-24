import { randomBytes } from 'node:crypto';
console.log('SESSION_SECRET=' + randomBytes(48).toString('base64url'));
console.log('INTERNAL_API_SECRET=' + randomBytes(48).toString('base64url'));
