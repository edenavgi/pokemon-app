// What the bot says. Plain text (no Markdown), so names with * or _ can't break a message.
export const texts = {
  linked: (name: string, accountName: string, userId: string, accountId: string) =>
    `Linked! This chat now plays as ${name} on the ${accountName} account (user ${userId}, account ${accountId}).`,
  badCode: 'That link has expired or was already used. Open Gym HQ → Connect → Connect Telegram to get a new one.',
  notLinked: 'Link your account from the app first: open Gym HQ → Connect → Connect Telegram.',
  noBoards: 'Your Gyms and Pokémon boards are not set yet. Open Gym HQ in monday once, then try again.',
  reconnect: 'The bot lost access to your monday account. Open Gym HQ → Connect → Connect to monday, then try again.',
  unknownCommand: 'More commands are coming soon.',
} as const
