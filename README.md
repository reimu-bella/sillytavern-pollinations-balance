# SillyTavern Pollinations Balance

A small SillyTavern extension that displays your Pollinations pollen balance, estimates hourly tier pollen remaining, and refreshes when a chat response generation starts.

## Features

- Shows the current pollen balance from `https://gen.pollinations.ai/account/balance`.
- Estimates hourly tier pollen remaining for Spore, Seed, and Flower accounts from recent `meter_source: "tier"` usage.
- Estimates paid/other pollen as total balance minus estimated tier pollen remaining.
- Adds an unobtrusive bottom-left tier-balance button that toggles a top-left balance panel on the main SillyTavern view.
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

The key must be allowed to call these Pollinations account endpoints:

```http
GET https://gen.pollinations.ai/account/balance
GET https://gen.pollinations.ai/account/profile
GET https://gen.pollinations.ai/account/usage
Authorization: Bearer YOUR_API_KEY
```

Use a key with `account:balance`, `account:profile`, and `account:usage` permissions. If the key only has `account:balance`, the extension can still show the total balance but cannot estimate tier-vs-paid pollen.

Because SillyTavern UI extensions run in the browser, prefer a constrained or publishable Pollinations key with only the required account permissions. Avoid pasting a full secret server key unless you understand the exposure risk.

## Tier Estimate

Pollinations does not currently expose separate remaining balances for free tier pollen and paid/pack/crypto pollen. This extension estimates the split:

- Spore starts each hour with `0.01` tier pollen.
- Seed starts each hour with `0.15` tier pollen.
- Flower starts each hour with `0.4` tier pollen.
- Current-hour usage records with `meter_source: "tier"` are summed from `cost_usd`.
- Estimated tier remaining is `hourly allowance - current hour tier usage`, clamped at zero.
- Estimated paid/other pollen is `total balance - estimated tier remaining`, clamped at zero.

The estimate depends on the usage endpoint returning the current hour's records and treats usage `cost_usd` as the pollen-denominated spend value used by the account API.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
