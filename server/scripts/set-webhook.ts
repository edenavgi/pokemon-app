// Points the bot's webhook at a server and registers its command menu: npm run webhook:set -- <baseUrl>
// e.g. the cloud URL, or the tunnel URL while testing locally. Telegram keeps ONE webhook per bot.
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from server/.env (tsx --env-file=.env).
import { createTelegramApi } from '../src/telegram/api'
import { BOT_COMMANDS } from '../src/telegram/commands'

const baseUrl = process.argv[2]?.replace(/\/+$/, '')
const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!baseUrl?.startsWith('https://') || !token || !secret) {
  console.error('Usage: npm run webhook:set -- https://<server>  (needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in server/.env)')
  process.exit(1)
}
const url = `${baseUrl}/telegram/webhook`
const telegram = createTelegramApi(token)
await telegram.setWebhook(url, secret)
console.log(`Webhook set: ${url} (message updates only, secret header on)`)
await telegram.setMyCommands(BOT_COMMANDS)
console.log(`Command menu set: ${BOT_COMMANDS.map((c) => `/${c.command}`).join(' ')}`)
