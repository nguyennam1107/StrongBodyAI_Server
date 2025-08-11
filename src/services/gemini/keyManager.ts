import { geminiKeys } from '../../config/env.js';

interface KeyState {
  key: string;
  index: number;
  healthy: boolean;
  cooldownUntil?: number;
  consecutiveErrors: number;
  lastUsed?: number;
  tokensUsedLastMinute: number;
}

const keyStates: KeyState[] = geminiKeys.map((k, i) => ({
  key: k,
  index: i,
  healthy: true,
  consecutiveErrors: 0,
  tokensUsedLastMinute: 0
}));

let rrPointer = 0;

export function pickKey(): KeyState | null {
  const now = Date.now();
  for (let i = 0; i < keyStates.length; i++) {
    const idx = (rrPointer + i) % keyStates.length;
    const ks = keyStates[idx];
    if (!ks.healthy && ks.cooldownUntil && ks.cooldownUntil > now) continue;
    if (!ks.healthy && ks.cooldownUntil && ks.cooldownUntil <= now) {
      // cooldown ended, reset
      ks.healthy = true; ks.consecutiveErrors = 0; ks.cooldownUntil = undefined;
    }
    rrPointer = idx + 1;
    ks.lastUsed = now;
    return ks;
  }
  return null;
}

export function reportSuccess(key: string) {
  const ks = keyStates.find(k => k.key === key);
  if (ks) {
    ks.consecutiveErrors = 0;
    ks.healthy = true;
  }
}

export function reportError(key: string, severe: boolean) {
  const ks = keyStates.find(k => k.key === key);
  if (!ks) return;
  ks.consecutiveErrors += 1;
  if (severe || ks.consecutiveErrors >= 3) {
    ks.healthy = false;
    ks.cooldownUntil = Date.now() + 5 * 60 * 1000; // 5 min cooldown
  }
}

export function listKeyStates() {
  return keyStates.map(k => ({ key: mask(k.key), healthy: k.healthy, cooldownUntil: k.cooldownUntil, consecutiveErrors: k.consecutiveErrors }));
}

function mask(key: string) {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}
