# Reels Enjoy — project notes (handoff)

Short-video (reels) app where creators and viewers earn; owner earns from ads and gift commission.
Owner works only from a phone (Bengali UI). Everything is free-tier: Supabase + GitHub Pages + GitHub Actions.

## Pieces
| What | Where |
| --- | --- |
| Admin panel (web) | this repo root → https://akashpattadar19-cell.github.io/reels-admin/ |
| User app (web, loaded inside the APK) | `app/` → https://akashpattadar19-cell.github.io/reels-admin/app/ |
| Android APK shell (AdMob, video compression, share) | private repo `reels-app` |
| Database, RPCs, cron, storage | Supabase project `reels-enjoy` (ref `smveeoykybpufhvcehjv`, ap-south-1) |
| SQL migrations / edge functions (source copy) | `supabase/` |

## Money rules (all in Postgres functions, never in the client)
- All money is BIGINT paisa (1 taka = 100). Balances change ONLY through `_wallet_move()`, which writes a ledger row in `transactions`.
- Wallet buckets: `coin_balance` (bought via cash-in, only for gifts, never withdrawable), `earning_paisa` (withdrawable),
  `pending_paisa` (earnings waiting `pending_hold_hours`, released hourly by cron `release_pending`), `points` (viewer rewards).
- Creator earns: views (`credit_view_earnings` hourly, rate per 1000 valid views, daily cap), first like per user, first comment per user, gifts (creator_share_pct).
- Viewer earns points: valid view (≥ min_watch_ms, once per video per day, daily cap) and AdMob rewarded ads (server-verified via `admob-ssv` edge function → `grant_ad_reward`).
- Withdraw: `request_withdraw` holds money immediately; 7-day cooldown counted from last non-rejected request; one open request max; admin approve → paid (TrxID) or reject (refund).
- Cash-in: manual — user sends bKash/Nagad to numbers in settings and submits TrxID; admin approves → coins.
- All rates/limits live in `settings` and are editable from the admin panel.

## Auth
Phone (any country, E.164 like +8801…, +9665…) or email + password; no SMS cost.
`signup` edge function creates the auth user with a random internal email `u<hex>@id.reelsenjoy.app` (confirmed) and stores
phone / optional real email / that login email in `user_private`. `resolve-login` maps phone or email → login email, then the
client calls `signInWithPassword`.
Admin resets passwords via `admin-tools` edge function. Admin = `profiles.role = 'admin'`.

## Security
RLS on every table; clients can only SELECT. All writes go through SECURITY DEFINER RPCs that check `auth.uid()`;
admin RPCs call `_require_admin()`. `anon` cannot execute any function.
