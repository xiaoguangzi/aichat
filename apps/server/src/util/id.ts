import { randomUUID, randomBytes } from 'node:crypto';
export const uuid = () => randomUUID();
export const shortId = (prefix = '') => prefix + randomBytes(8).toString('hex');
export const nowIso = () => new Date().toISOString();
