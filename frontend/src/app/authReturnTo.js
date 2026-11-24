import { PATHS } from './paths.js';

export function safeAuthReturnTo(value) {
  if (typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f]/.test(value)) {
    return PATHS.dashboard;
  }
  const target = new URL(value, window.location.origin);
  return target.origin === window.location.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : PATHS.dashboard;
}
