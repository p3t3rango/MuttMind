import { createHmac, timingSafeEqual } from 'crypto';
import { env } from './env';

const TELEGRAM_LINK_TTL_MS = 1000 * 60 * 15;

function getSigningSecret() {
  if (!env.telegramWebhookSecret) {
    throw new Error('Missing TELEGRAM_WEBHOOK_SECRET.');
  }

  return env.telegramWebhookSecret;
}

function compactUserId(userId: string) {
  return userId.replace(/-/g, '').toLowerCase();
}

function expandUserId(compactId: string) {
  return compactId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

function signToken(data: string) {
  return createHmac('sha256', getSigningSecret()).update(data).digest('base64url').slice(0, 16);
}

export function createTelegramStartPayload(userId: string, now = Date.now()) {
  const compactId = compactUserId(userId);
  const timestamp = now.toString(36);
  const data = `${compactId}.${timestamp}`;
  return `u_${compactId}_${timestamp}_${signToken(data)}`;
}

export function parseTelegramStartPayload(payload: string, now = Date.now()) {
  const match = payload.match(/^u_([a-f0-9]{32})_([a-z0-9]+)_([A-Za-z0-9_-]{16})$/);
  if (!match) return null;

  const [, compactId, timestamp, signature] = match;
  const issuedAt = Number.parseInt(timestamp, 36);
  if (!Number.isFinite(issuedAt) || now - issuedAt > TELEGRAM_LINK_TTL_MS || issuedAt - now > 60_000) {
    return null;
  }

  const expected = signToken(`${compactId}.${timestamp}`);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  return { userId: expandUserId(compactId) };
}

async function getTelegramBotUrl() {
  const configuredBotUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL?.trim().replace(/\?.*$/, '').replace(/\/$/, '');
  if (configuredBotUrl) return configuredBotUrl;

  const configuredUsername = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  if (configuredUsername) return `https://t.me/${configuredUsername}`;

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or NEXT_PUBLIC_TELEGRAM_BOT_URL.');
  }

  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
  const data = await response.json();
  const username = data?.result?.username;
  if (!response.ok || !username) {
    throw new Error('Unable to resolve Telegram bot username.');
  }

  return `https://t.me/${username}`;
}

export async function createTelegramStartUrl(userId: string) {
  const botUrl = await getTelegramBotUrl();
  return `${botUrl}?start=${createTelegramStartPayload(userId)}`;
}
