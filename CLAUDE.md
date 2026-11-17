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

## Other features
- `profiles.user_no`: public numeric ID (from 100001) shown in the app; admin "Coin Sent" page mints coins to a user_no via `admin_send_coins` (ledger type `admin_coin_grant`).
- Uploads start as `pending`; cron `auto_approve_videos` publishes them after `auto_approve_minutes` (0 = manual only). Admin approves/rejects in Videos → Pending.
- Locked folder (`vault` private bucket + `vault_files`): per-user quota `vault_quota_mb` (enforced in `vault_add` and the storage insert policy); only the owner and admins can read.
- Language: `i18n.js` (shared by admin and app) translates Bengali UI text to English at runtime from a phrase map when `localStorage.lang = 'en'`.
  Elements with `translate="no"` (user captions, names, comments, bios, admin notice) are never translated. New UI text → add its English to the map.
- Referral: signup takes `ref_no` (referrer's user_no) → `profiles.referred_by`. When the new user reaches `referral_min_views` valid views,
  `_check_referral` (called from `record_view`) pays the referrer `referral_bonus_paisa` (pending) + welcome points to the new user, and
  one-time tier bonuses from `referral_tiers` (`referral_tier_awards`). Admin edits all rates on the "Income rules" page.
- Categories: `videos.category` (natok/movie/funny/vlog/music/other); feed RPC takes `p_category`; set via `set_video_category` after upload.
- Location: APK (≥ v1.0.3) blocks the app until coarse location is allowed; Android Geocoder gives country/city → `update_location`
  (stored rounded to ~1 km in `user_private`). Admin "User lookup" page (`admin_user_detail(user_no)`) shows profile, phone country,
  location, birth date, referrals, wallet and all posts.
- Adult/18+ content: owner asked for a paid 18+ folder; declined (illegal in BD/KSA, breaks AdMob policy, CSAM risk). Don't build it.
- Live streaming: not built yet (owner postponed; needs ZEGOCLOUD/Agora + FLAG_SECURE in the APK for no screenshots).

## Security
RLS on every table; clients can only SELECT. All writes go through SECURITY DEFINER RPCs that check `auth.uid()`;
admin RPCs call `_require_admin()`. `anon` cannot execute any function.
