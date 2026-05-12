# SillyTavern Pollinations Balance

A small SillyTavern extension that displays your Pollinations pollen balance and refreshes it when a chat response generation starts.

## Features

- Shows the current pollen balance from `https://gen.pollinations.ai/account/balance`.
- Refreshes on SillyTavern app ready, manual button click, and `GENERATION_STARTED`.
- Stores the API key in SillyTavern extension settings.
- Prevents overlapping balance requests and shows loading/error/last-updated states.

## Installation

Clone or copy this folder into one of SillyTavern's extension locations:

- User install: `SillyTavern/data/<user>/extensions/sillytavern-pollinations-balance`
- All users/local development: `SillyTavern/public/scripts/extensions/third-party/sillytavern-pollinations-balance`

Restart SillyTavern or reload the browser page, then enable **Pollinations Balance** from the extensions panel.

## Configuration

1. Open SillyTavern's extensions settings.
2. Find **Pollinations Balance**.
3. Paste a Pollinations API key.
4. Click **Save key** or **Refresh balance**.

The key must be allowed to call the Pollinations `account:balance` endpoint. The request is sent as:

```http
GET https://gen.pollinations.ai/account/balance
Authorization: Bearer YOUR_API_KEY
```

Because SillyTavern UI extensions run in the browser, prefer a constrained or publishable Pollinations key with only the `account:balance` permission. Avoid pasting a full secret server key unless you understand the exposure risk.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
