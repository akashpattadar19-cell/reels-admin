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
- `profiles.user_no`: public numeric ID (from 100001) shown in the app; admin "Coin Sent" page mints coins to a user_no via `admin_send_coins` (admin types taka → coins from `coin_price_paisa`) (ledger type `admin_coin_grant`).
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
- App layout (Chamet-style, own icons): tabs Home (Discover 2-column grid: Nearby/Discover/Friends, language + country filters) ·
  Reels (`#feed`, full-screen player, categories) · ＋ · Inbox · Me (compact profile that fits one screen). Light theme; reels stay dark.
- Account type: `profiles.account_type` user|host. User asks in Settings → `set_account_type('host')` → admin approves (dashboard
  "হোস্ট আবেদন" / lookup page) unless `host_auto_approve`. Hosts watch all premium free.
- Premium videos: `videos.is_premium/premium_coins`, set via `set_video_premium` after upload; never auto-approved; viewers pay with
  `unlock_premium` (creator gets `premium_creator_pct` as pending). Non-explicit content only.
- Upload limit: `settings.daily_upload_limit` (5), per-user override `profiles.daily_upload_limit` (admin lookup page).
- Jail: `admin_jail_user(user, true, reason, fee_coins)`; `_active_user()` raises JAILED so jailed users can't act; app shows `#jail`
  and user pays `pay_jail_release()` (fee default `jail_release_coins`).
- Level: `_level(followers)` thresholds 10/50/200/1000/5000/20000.
- Home tabs: ভিডিও (video grid) · ফটো (photo posts) · কম্পিটিশন (photo contests). Bottom tab 4 = ✍️ Text Earning (`#texts`,
  copy blocked + `ReelsAndroid.setSecure(true)` → FLAG_SECURE). Messages/notifications moved to Me → মেসেজ (`#inbox`, `#chat/<uid>`).
- `posts` (kind photo|text, `photos` bucket) with `post_likes/comments/shares`; owner earns via `_post_earn` (post_*_rate_paisa,
  daily cap). Gifts on posts: `send_post_gift`. Contests: `contests`, admin creates/announces winner (prize → winner balance).
- DMs: `messages`, `send_message`, `my_chats`, `chat_messages` (setting `dm_enabled`). Cover photo: `profiles.cover_url` via `set_cover`.
- Premium: only hosts upload (`premium_upload_hosts_only`); hosts watch free only if admin sets `profiles.premium_access`.
  Notice text in `settings.premium_notice` (requires own/licensed content, no obscene).
- Analytics: app sends `track_time` every minute → `app_usage`; admin "অ্যানালিটিক্স" (`admin_analytics`): time, categories, posts, countries.
- APK ≥ v1.0.4: asks camera, photos/videos, notifications; camera capture for photos; `notify(title, body)` local notifications
  while the app is in background (no Firebase push yet).
- Buy coins: notice text `settings.cashin_notice` (admin Income rules page) shown under the numbers; optional payment
  screenshot → private bucket `proofs` (`<uid>/<id>-*.jpg`) via `set_cash_in_proof`; admin sees it on Cash-in page (signed URL).
- APK ≥ v1.0.5 is edge-to-edge: native pushes `--safe-t/--safe-b` CSS vars; `ReelsAndroid.setDarkBars(bool)` per page.
- Settings (app `#settings`): Live Support, Telegram link, notifications toggle, policies (`#policy/<key>` renders
  `/policy/<key>.html`, bilingual public pages for Play Store: privacy, terms, community, child-safety, copyright, coins,
  earnings, delete-account, about), delete account (`#delacct`). Old settings (account type, wallet, vault, language, logout)
  are in the own profile page under "⚙️ আমার অ্যাকাউন্ট". Signup requires an 18+ / terms checkbox.
- Live support: `support_threads/support_messages`, `support_send`, admin pages `#support/user` and `#support/host`
  (`admin_support_*`). Telegram bridge = edge function `support-telegram` (verify_jwt off): admin saves BotFather token
  (`private_config`, service-role only) → setup sets webhook → admin taps Start link; user messages go to Telegram with
  `#U<user_no>`, admin replies by Telegram Reply → `support_reply_by_user_no`.
- Account deletion: `request_account_deletion` → cron `process-account-deletions` anonymises after 7 days (`_delete_account`),
  or admin "অ্যাকাউন্ট ডিলিট" page deletes now. Money ledger rows are kept.
- Devices: APK ≥ v1.0.6 `ReelsAndroid.deviceInfo()` (ANDROID_ID + brand/model/OS) → `register_device` (stores md5 hash in
  `user_devices`). `_check_referral` blocks (`profiles.referral_blocked='same_device'`) when the new account's phone was
  used by any other account; `referral_require_device` makes referrals count only after an APK login. Admin "📱 ডিভাইস" page.
- Downloads: reels "সেভ" button → APK ≥ v1.0.9 `ReelsAndroid.downloadVideo(url, brand, username, id)` downloads, burns a
  one semi-transparent moving watermark (app icon + `settings.watermark_text` + @username; BitmapOverlay whose
  position follows a slow sine path over time, media3 OverlayEffect) and saves
  to Movies/ReelsEnjoy; progress via `window.onDownloadState`. Premium videos can't be downloaded. `downloads_enabled` toggle.
- Share: every share text ends with `settings.share_link` + `?ref=<user_no>` → landing page `get/` (OG preview image
  `get/og.png`, shows the referral code, auto-starts the APK download from `download/Reels-Enjoy.apk`).
- Welcome bonus: `register_device` → `_grant_welcome` pays `welcome_bonus_paisa` (৳20) to `earning` once, only for accounts
  created after `welcome_bonus_since` and only if no other account used that phone; app shows a 🎁 popup.
- Chat: `messages.delivered_at/read_at/edited_at/reply_to`; ✓ sent, ✓✓ delivered (`mark_delivered` on app start/new msg),
  blue ✓✓ seen (`chat_messages`/`mark_read`). Swipe right = reply, long-press = reply/copy/edit (24 h)/delete
  (`edit_message`, `delete_message`); realtime UPDATE events repaint ticks.
- Profile edit: avatar (1:1) and cover (3:1) crop with drag (`photoFramer(box, img, fixedRatio)`), remove via `remove_photo`,
  gender (`set_gender`, used for viewer stats).
- Creator dashboard `#creator/<7|30|90>` (`creator_stats`): income by source, KPIs, daily views, viewer gender/countries,
  per-video views/likes/comments/shares/downloads/income (view income estimated from valid views × rate).
- Coin price & offers (admin "Coin Sent" page): `coin_price_paisa` + `min_cash_in_taka` editable there; `coin_offers`
  (title, price_taka, coins, badge, active, ends_at, sort) via `admin_coin_offers/admin_save_coin_offer/admin_delete_coin_offer`
  (delete only disables once used). App shows offers on Buy coins + a once-a-day popup; `request_cash_in(..., p_offer_id)`
  requires the exact offer price and grants the offer's coins (`cash_in_requests.offer_id`).
- Profiles: hosts get a gold profile (crown ring, 👑 HOST badge, host strip, Premium tab); users get 👤 ইউজার + level badge.
- Signup asks gender (ছেলে/মেয়ে) and language (বাংলা/English; switches UI immediately, form kept via sessionStorage `regDraft`);
  after signup the app calls `set_gender` and `set_language`.
- Host income rules: settings `host_<key>` override `<key>` for hosts via `_urate(user, key)` (view rate/cap, like, comment,
  post rates/cap, premium %, referral bonus) and `_gift_pct` (`host_gift_creator_pct`, 0 = gift's own %). Admin "ইনকাম রুলস" has
  two cards: `#rules/user` and `#rules/host`. Admin "ইউজার" page has User / Host cards (`admin_users(..., p_type)`, `admin_user_type_counts`).
- Coin sellers: admin makes a host a seller (`admin_set_coin_seller`, lookup page or `#sellers`). Seller sells from own
  coin_balance in app `#seller` (`seller_sell_coins`): buyer gets coins, seller loses coins + commission
  (`seller_commission_pct` or per-seller %). `coin_sales` ledger; seller profiles get a purple-gold design + "buy coins" chat CTA;
  Buy coins page lists sellers.
- Withdraw numbers: `payout_accounts` (max 5) via `add_payout_account/delete_payout_account`; withdraw page picks a saved number.
  Me page has quick buttons (উইথড্র / কয়েন কিনুন / লেনদেন).
- TODO (owner postponed): move video storage to Cloudflare R2 (account opened; needs bucket + API keys) and allow 1 s – 59 min videos.
- Adult/18+ content: owner asked for a paid 18+ folder; declined (illegal in BD/KSA, breaks AdMob policy, CSAM risk). Don't build it.
- Live streaming: not built yet (owner postponed; needs ZEGOCLOUD/Agora + FLAG_SECURE in the APK for no screenshots).

## App updates (APK)
Public APK for in-app updates: `download/Reels-Enjoy.apk` in this repo (GitHub Pages). After a new reels-app release:
copy the APK there, push, then set `latest_app_build` (X of 1.0.X) and `min_app_build` (= latest to force) — admin
"📲 অ্যাপ আপডেট" page or SQL. App shows `#updGate` when its build < latest (blocking when < min); APK ≥ v1.0.11
`ReelsAndroid.installUpdate(url)` downloads and opens the installer, older APKs open the link in the browser.

Google Play: reels-app has flavors `direct` (website APK, self-update) and `play` (AAB, no REQUEST_INSTALL_PACKAGES;
`installUpdate` opens the Play Store; `ReelsAndroid.store()` = "play"). CI attaches `Reels-Enjoy-play.aab` to each release.
Play users are gated by `play_latest_build` / `play_min_build` (raise only after Google approves that version).

## Deploy
Before every push of web changes run `python3 tools/stamp.py` (adds `?v=<time>` to script/css links in both index.html files)
so phones load the new files immediately. APK ≥ v1.0.7 also opens the app URL with `?v=<now>` on each start.

## Security
RLS on every table; clients can only SELECT. All writes go through SECURITY DEFINER RPCs that check `auth.uid()`;
admin RPCs call `_require_admin()`. `anon` cannot execute any function.
