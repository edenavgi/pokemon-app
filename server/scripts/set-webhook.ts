// Points the bot's webhook at a server: npm run webhook:set -- <baseUrl>
// e.g. the cloud URL, or the tunnel URL while testing locally. Telegram keeps ONE webhook per bot.
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from server/.env (tsx --env-file=.env).
import { createTelegramApi } from '../src/telegram/api'

const baseUrl = process.argv[2]?.replace(/\/+$/, '')
const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!baseUrl?.startsWith('https://') || !token || !secret) {
  console.error('Usage: npm run webhook:set -- https://<server>  (needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in server/.env)')
  process.exit(1)
}
const url = `${baseUrl}/telegram/webhook`
await createTelegramApi(token).setWebhook(url, secret)
console.log(`Webhook set: ${url} (message updates only, secret header on)`)
