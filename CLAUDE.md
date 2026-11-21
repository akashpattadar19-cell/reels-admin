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
| Public website (offers, rules, FAQ, contact) | `site/` → https://akashpattadar19-cell.github.io/reels-admin/site/ |
| Own domain (Cloudflare, bought 2026-11-20) | https://reelsenjoy.com = Worker `reelsenjoy-site` (source `cf-worker/`, auto-built from this repo by Workers Builds, path /cf-worker) proxying site/ at `/` and get/, v/, policy/, download/ from GitHub Pages. App + admin stay on github.io (moving them would log every user out). `share_link` = https://reelsenjoy.com/get/. Email: support@reelsenjoy.com → Cloudflare Email Routing → reelsenjoy.app@gmail.com. |
| SQL migrations / edge functions (source copy) | `supabase/` |

## Money rules (all in Postgres functions, never in the client)
- All money is BIGINT paisa (1 taka = 100). Balances change ONLY through `_wallet_move()`, which writes a ledger row in `transactions`.
- Wallet buckets: `coin_balance` (bought via cash-in, only for gifts, never withdrawable), `earning_paisa` (withdrawable),
  `pending_paisa` (earnings waiting `pending_hold_hours`, released hourly by cron `release_pending`), `points` (viewer rewards).
- Creator earns: views (`credit_view_earnings` hourly, rate per 1000 valid views, daily cap), first like per user, first comment per user, gifts (creator_share_pct).
- Viewer earns points only for a FULL watch (037): `record_view` at min_watch_ms counts the view (creator income, referral) but gives no points;
  app calls `claim_watch_reward` when watched ≥ `watch_full_pct` (95) % of `duration_sec` → `watch_points` once per video per day (daily cap),
  server also checks real elapsed time since the view row (`video_views.rewarded_at`). Earlier: valid view (≥ min_watch_ms, once per video per day, daily cap) and AdMob rewarded ads (server-verified via `admob-ssv` edge function → `grant_ad_reward`).
- Withdraw: `request_withdraw` holds money immediately; cooldown (15 days since 059, fast-withdraw users less) counted from last non-rejected request; one open request max; admin approve → paid (TrxID) or reject (refund).
- Cash-in: manual — user sends bKash/Nagad to numbers in settings and submits TrxID; admin approves → coins.
- All rates/limits live in `settings` and are editable from the admin panel.

## Auth
Phone (any country, E.164 like +8801…, +9665…) or email + password; no SMS cost.
`signup` edge function creates the auth user with a random internal email `u<hex>@id.reelsenjoy.app` (confirmed) and stores
phone / optional real email / that login email in `user_private`. `resolve-login` maps phone or email → login email, then the
client calls `signInWithPassword`.
Admin resets passwords via `admin-tools` edge function. Admin = `profiles.role = 'admin'`.
One-time password (forgot password): admin user page / lookup page "🔑 এককালীন পাসওয়ার্ড" → `admin-tools` action `one_time_password`
(server-generated 8 chars, sets `user_private.must_change_pw` + `temp_pw_expires` = 24 h) → modal with copy / WhatsApp message.
App `start()`: must_change_pw → `#pwForm` (new password ×2 → `auth.updateUser` → `clear_must_change_pw`); expired → sign out.

## Other features
- `profiles.user_no`: public numeric ID (from 100001) shown in the app; admin "Coin Sent" page mints coins to a user_no via `admin_send_coins` (admin types taka → coins from `coin_price_paisa`) (ledger type `admin_coin_grant`).
- Uploads start as `pending`; cron `auto_approve_videos` publishes them after `auto_approve_minutes` (0 = manual only — owner's choice since 038). Admin approves/rejects in Videos → Pending
  (reject reason picker: watermark/logo, TikTok/other page, …). Upload reward (038): `admin_video_action('approve')` pays the uploader
  `upload_reward_coins` (10) coins once per video (`videos.reward_coins`, ledger `upload_reward`); rule card on `#upload` (own real video, no watermark/logo/page name).
- Ad diagnostics (038, APK ≥ v1.0.20; v1.0.19 = Play Billing bridge): native `onAdFail(placement, code, msg)` → `log_ad_error` → `ad_errors`, shown on admin Ads page with code meanings.
- App re-reads `settings` every 2 min and when it returns to the foreground, so rate changes (coin price etc.) show everywhere without a restart.
- Locked folder (`vault` private bucket + `vault_files`): per-user quota `vault_quota_mb` (enforced in `vault_add` and the storage insert policy); only the owner and admins can read.
- One language per user (owner's rule — never mix): i18n.js has PRE/POST regex rules for sentences with numbers (days, hours, until, max, N জন…)
  around the phrase map; in Bengali mode the app (`window.I18N_BN_DIGITS`) shows Bengali digits (links, @names, #tags, versions kept), dates use bn-BD/en-GB by language.
  Check with a crawl: render every route with lang=en and list text nodes that still contain Bengali (must be 0 except user content).
  Website swaps media by language (`data-src-en`: app-tour-en.mp4, *-en.jpg screenshots).
  App helpers: `L(bn, en)` for strings built in JS (share texts, confirms, native notifications), `admTxt(x)` for admin-written text
  without an `_en` field (translated if the map covers it fully, else hidden in English), `trx(x)` = map translation for text that never
  reaches the DOM (native notifications). Server notification sentences with names/numbers are PRE rules in i18n.js.
  Native shell texts follow `ReelsAndroid.setLang(lang)` (APK ≥ v1.0.21). `get/` landing page is bilingual (`?lang=en`, share links add it).
  Audit tools (rebuild if lost): extract Bengali literals with acorn, run them through `window.t`, list leftovers; check tr(tr(x)) == tr(x).
- Admin panel: grouped, collapsible menu (`.ng` groups, state in localStorage `navClosed`) + menu search `#navQ`; dashboard ID search + quick-action tiles;
  `quickFilter()` runs after every route and adds search / type (`data-k`,`data-kl`) / date (`data-ts`) / amount sort (`data-amt`) to the biggest list on the page.
- Language: `i18n.js` (shared by admin and app) translates Bengali UI text to English at runtime from a phrase map when `localStorage.lang = 'en'`.
  Elements with `translate="no"` (user captions, names, comments, bios) are never translated — keep fixed UI text outside them.
  New UI text → add its English to the map (audit: extract Bengali literals from app/app.js + SQL, run them through the map, list leftovers).
  Admin-written notices are bilingual: `settingL(key)` shows `<key>_en` when English is chosen (app_notice, premium_notice, cashin_notice,
  text_notice, live_rules_notice, update_message); admin panel has an English field next to each.
- Referral: signup takes `ref_no` (referrer's user_no) → `profiles.referred_by` (`referred_at` set by `set_referrer`). Since 039 the new user must
  finish tasks within `ref_window_days` (3) counted from max(referred_at/created_at, `ref_rules_since`): `ref_req_full_watch` (rewarded full
  watches), `ref_req_likes`, `ref_req_comments`, `ref_req_shares`, `ref_req_active_days` with ≥ `ref_req_minutes_per_day` in `app_usage`,
  `ref_req_video_posts` (published), `ref_req_text_posts` (0 = off). `_referral_progress(user)` → {items[{k,need,have}], start, end, done};
  `_check_referral` (record_view + cron `referral-cron` every 10 min via `referral_cron()`) pays the referrer `referral_bonus_paisa`
  (host: `host_referral_bonus_paisa`) as pending + `referral_welcome_points` to the new user + `referral_tiers` bonuses; after end + 3 days
  grace → `referral_blocked='expired'`. App `#invite`: offer banner (`settingL('ref_offer_text')`), own tasks (`my_referral_tasks`), rules
  and per-friend progress (`my_referrals.list[].progress`); `#rules` shows own task card. Admin "🎁 রেফার" page `#referrals/<running|done|failed|all>`
  (`admin_referrals`): all referral settings, offer text bn/en, anti-fraud toggles, bonus tiers, top referrers, list with progress.
- Referral without signup form (Google): login page "🎁 বন্ধুর রেফার কোড আছে?" stores `localStorage.refNo`, `start()` calls
  `set_referrer` once; Me page shows a "বন্ধুর রেফার কোড দিন" box while `referred_by` is null and the account is < `referral_add_days` old.
- Categories: `videos.category` (natok/movie/funny/vlog/music/other); feed RPC takes `p_category`; set via `set_video_category` after upload.
- Location: APK (≥ v1.0.3) blocks the app until coarse location is allowed; Android Geocoder gives country/city → `update_location`
  (stored rounded to ~1 km in `user_private`). Admin "User lookup" page (`admin_user_detail(user_no)`) shows profile, phone country,
  location, birth date, referrals, wallet and all posts.
- App layout (Chamet-style, own icons): tabs Home (Discover 2-column grid: Nearby/Discover/Friends, language + country filters = buttons opening a chip panel `#dfPan`, order from `discover_facets()` (056) = most creators first) ·
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
  copy blocked + `ReelsAndroid.setSecure(true)` → FLAG_SECURE). Messages in Me → মেসেজ (`#inbox` = chats only, `#chat/<uid>`); notifications on Home's 🔔 bell (`#notifs`, red badge = unread).
- `posts` (kind photo|text, `photos` bucket) with `post_likes/comments/shares`; owner earns via `_post_earn` (post_*_rate_paisa,
  daily cap). Gifts on posts: `send_post_gift`. Contests: `contests`, admin creates/announces winner (prize → winner balance).
- DMs: `messages`, `send_message`, `my_chats`, `chat_messages` (setting `dm_enabled`). Cover photo: `profiles.cover_url` via `set_cover`.
- Premium: only hosts upload (`premium_upload_hosts_only`); hosts watch free only if admin sets `profiles.premium_access`.
  Notice text in `settings.premium_notice` (requires own/licensed content, no obscene).
- Analytics: app sends `track_time` every minute → `app_usage`; admin "অ্যানালিটিক্স" (`admin_analytics`): time, categories, posts, countries.
- APK ≥ v1.0.4: asks camera, photos/videos, notifications; camera capture for photos; `notify(title, body)` local notifications
  while the app is in background.
- Push (054, APK ≥ v1.0.23): Firebase Cloud Messaging. reels-app reads `app/google-services.json` in gradle (no plugin; resValues
  google_app_id/api_key/sender/project, `BuildConfig.HAS_FCM`); `PushService` shows data messages (title, body, route, kind call|msg|notif, tag;
  channels reels_push + reels_calls with ringtone; skipped while the app is in the foreground). Bridge: `pushToken()` → `window.onPushToken`,
  `notifStatus()` granted|denied|blocked, `requestNotif()` → `window.onNotifPerm`, `takeRoute()` (route from a tapped notification; also
  `openPushRoute` via onNewIntent). App: `requireNotif()` = blocking `#notifGate` until notifications are allowed (owner's rule), then
  `save_push_token(token, lang)`; logout → `remove_push_token`; `pendingCall()` shows a still-ringing call on start. Server: `push_tokens`,
  triggers on notifications/messages/calls(ringing) → `_push(user, kind, ref)` → pg_net → edge function `send-push` (x-push = `push_secret`;
  FCM HTTP v1 with the service account in `private_config.fcm_service_account`, set on admin "📲 অ্যাপ আপডেট" → Push card, test button;
  English users get English templates, never mixed). Location stays coarse/foreground only (background location would fail Play review).
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
  Video approval group (052): admin gets a code (`admin_telegram_mod('code')`), adds the bot to a group and sends `/mod <code>` →
  `private_config.telegram_mod_chat`. Cron `tg-mod` (`tg_mod_cron()`, every min, only when pending videos with `videos.tg_sent_at` null)
  → edge fn (x-cron = `tg_cron_secret`) `modRun()` posts sendVideo (fallback thumb/text + link) with ✅ Approve / ❌ Reject (reason list) buttons;
  callback → `_tg_video_action(admin_uid, id, action, reason)` (service_role only, acts as `telegram_admin_uid`, only while pending) and edits the message.
  Posts (053): photo/text posts also go there (`posts.tg_sent_at`); published → ✅ ঠিক আছে / 🗑 ডিলিট (reason list), pending → Approve/Reject;
  `_tg_post_action(admin, id, approve|remove, reason)` → `admin_post_action` (remove = delete if published, reject if pending).
  Anyone in that group can press the buttons. Webhook allowed_updates include callback_query (re-run setup after changing).
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
  Me page: coins card → #cashin, balance card → #wallet (withdraw inside), লেনদেনের হিসাব in the menu; compact "＋ পোস্ট করুন" row.
- Hashtags & mentions: triggers keep `video_hashtags`/`post_hashtags` and `mentions` in sync (notification type `mention`).
  App: `rich()` turns #tag → `#tag/<tag>` and @user → `#at/<username>`; `attachSuggest(el)` shows @user/#tag suggestions while
  typing (captions, text posts, comments); Home shows a trending chips row; `#tags/<1|7|30>` trending list; `#tag/<tag>/<v|p>/<top|new>`.
  Admin `#hashtags/<days>` (trending + who used a tag), lookup page shows the user's tags.
- Music & filters: admin uploads licensed/royalty-free songs on "🎵 মিউজিক" (`music` bucket + table). Upload pages use
  `mediaTools(box, preview, {kind})` (song via `pickMusic`, start offset, mute original, filter presets `FX_PRESETS` + brightness/
  contrast/saturation). Videos store `music_id/music_start/fx/orig_muted` via `set_media_extras`; feed fetches them per batch and
  plays the song with the shared `BGM` audio (stopped on every route change). Photo filters are baked into the JPEG; photo songs play on `#post`.
- Stories (24 h): `#newstory` (photo/video/text, filter, caption, song), `#story/<uid>` full-screen viewer (progress, tap/hold,
  replies via DM, viewers for owner); Home story row (`story_feed`), profile avatar ring. Admin "📖 স্টোরি" page + settings.
- Downloads with song/filter: APK ≥ v1.0.15 `ReelsAndroid.downloadVideo2(url, brand, user, id, optsJson)` — opts
  {music, start, mute, fx}; native mixes the song (looping EditedMediaItemSequence + forceAudioTrack; original muted via a
  zero ChannelMixingMatrix) and maps fx to media3 RgbAdjustment/HslAdjustment/Contrast/Brightness/RgbFilter. Older APKs are asked to update.
- Pro video editor (APK ≥ v1.0.16): `videoEditor()` on `#upload` — trim (long videos allowed, trimmed to `max_video_sec`), crop
  ratios with drag, emoji/text stickers (rendered to one PNG overlay), song from the app list or the phone (`<input accept=audio/*>`,
  native keeps `lastAudioUri`), song segment, original/song volume, filter. `ReelsAndroid.editAndUpload(spec)` renders with media3
  (Crop, Presentation ≤720p, fx, static BitmapOverlay, looping music sequence, ChannelMixing volumes) and uploads straight to
  Supabase storage with the user's JWT; progress via `window.onEditState`. Baked videos set `videos.music_baked` (no BGM/remix).
  Old APKs/browsers fall back to the simple upload + playback-time song/filter.
- Premium download: `premium_download(video)` charges `premium_download_coins` once (creator gets premium %); feed shows 🪙N on the save button.
- Video storage on Cloudflare R2 (041): uploads still go to Supabase `videos` bucket (web, APK editor, stories — no APK change).
  Cron `r2-move` (every min, `r2_cron()` → pg_net, only when `settings.r2_enabled` and `_r2_pending_count()` > 0) calls edge function
  `r2-move` (verify_jwt off; auth = header x-cron = `private_config.r2_cron_secret`, or an admin JWT): copies files older than 1 min to R2
  (aws4fetch S3 PUT, same key as the Supabase path), checks the public URL, rewrites `videos.video_url` / `stories.media_url`, deletes the
  Supabase file. `r2_tries` (max 5) per row. Keys in `private_config` r2_account_id/r2_access_key/r2_secret_key/r2_bucket/r2_public_url
  (R2 on since 2026-11-20, bucket reels-videos, public URL https://cdn.reelsenjoy.com — custom domain, cached; r2.dev URL still works but is rate-limited) set on admin "☁️ ভিডিও স্টোরেজ" (`#storage`, `admin_r2_status`, `admin_r2_retry`, test/run buttons).
  Thumbs/photos/avatars stay on Supabase. Deleting a video does not delete its R2 file. Still TODO: allow 1 s – 59 min videos.
- Adult/18+ content: owner asked for a paid 18+ folder; declined (illegal in BD/KSA, breaks AdMob policy, CSAM risk). Don't build it.
- Live & calls (Agora, APK ≥ v1.0.17 grants WebView camera/mic): Agora Web SDK (`agora-rtc-sdk-ng@4` from jsDelivr, lazy) runs in
  the WebView. Tokens from edge function `agora-token` (AccessToken2; verify_jwt off — it calls `agora_grant(channel)` with the
  user's JWT; App Certificate in `private_config`). App: live hosts shown first in Home → ভিডিও (`list_lives`; separate লাইভ tab removed), `#golive`, `#live/<id>` (host/viewer,
  chat, hearts, gifts via `live_gift`, co-host request/accept → renewToken + publish), host profile call buttons → `#call/<id>`;
  incoming call overlay from realtime on `calls`; both sides call `call_tick` every 30 s (per-minute billing). FLAG_SECURE during
  live/calls. Admin "🔴 লাইভ ও কল" (live monitor + end, rules, call/live history). Call prices: hosts set their own (`#callprice`,
  `my_call_price`/`set_my_call_price`, 1..`_call_cap` = `settings.call_price_caps[level]`); admin sets only commission
  (`call_host_pct` shown as commission = 100 − pct; per-host via `admin_set_call_commission` on the lookup page).
  No push yet: incoming calls ring only while the app is open (local notification if backgrounded).
- Moderation monitor (admin `#monitor`, `admin_monitor`): active lives/parties (thumb, viewers, guests) and calls; "👁 দেখুন" joins the
  Agora channel silently as subscriber (`agora_grant` lets admins subscribe to call channels; the call page only ends when the *other*
  party's uid leaves), ⏹ end (`live_end` / `admin_end_call`), 🚫 jail (`admin_jail_now` = jail + end their live/party/calls).
  Privacy policy keeps one short line ("may be reviewed for safety") — owner wanted no in-app notice; keep the policy line (Play/legal).
- PK battles (027): live host ⚔️ → `pk_candidates`/`pk_invite`; other host gets a sheet (realtime INSERT on `pk_battles`) → `pk_answer`.
  `live_rooms.pk_id` set on both rooms; `live_gift` adds coins to score_a/score_b; split screen (2nd Agora client joins the other
  room as audience); `pk_finish` at time-out or host ends early; `_pk_settle` pays winner `pk_winner_bonus_pct` % of its PK gift value
  (cap `pk_bonus_cap_paisa`) as pending; cron `pk-cron`. Settings pk_enabled/pk_duration_sec on admin "🔴 লাইভ ও কল" page.
- Live cards (028): `liveCard()` = home-card style (snapshot `live_rooms.thumb_url` uploaded by the host 4 s after going live via
  `live_set_thumb`, else avatar), shown first in Home → ভিডিও and in the লাইভ tab; 📞 on a card opens `callChooser`. `user_live(uid)`:
  chat shows a floating muted live preview (`livePip`, Agora audience, video only) → tap opens `#live/<id>`; profile avatar gets a LIVE ring.
- Middle ＋ tab button (`#plusBtn`) opens `plusSheet()`: লাইভ (→ `#golive`) and পার্টি (→ `#goparty`), hosts only by setting.
- Party voice rooms (029): `live_rooms.kind='party'` + `seats` + `free_seats`; `party_start`, `party_settings`, `party_mute`; seats =
  `live_cohosts` (accepted, `seat` number via `_seat_free`, `muted`); free seats auto-accept in `live_request_cohost`.
  `live_gift(..., p_to)` sends to host or a seated guest (`party_gift_pct`, else live rule). App `#party/<id>`: audio-only Agora,
  host seat + seat grid, green glow from volume-indicator, tap seat = request / gift / host mute+remove. Settings party_* on admin live page.
  Uploads (video/photo/story/text) moved to the Me page "＋ পোস্ট করুন" row.
- Room UI (030, Chamet-style) shared by live and party: `roomTopHtml/roomTopWire` (host chip with 🪙 room coins + ＋ follow,
  top-3 gifters, viewer count → `live_audience` sheet, 👑 টপ ফ্যান chip from `room_state`), pinned rules notice (`settings.live_rules_notice`,
  admin live page) + "Follow me" bubble, bottom bar 💬 (opens input) · 📞 call pill (`callPill`) · actions · ✕. Party = 3×3 tiles
  (🏠 host, coins received per seat from `room_state.recv`, flag, mic). `#myprofile` list page (ID copy, name, gender, age from birth date,
  region/location read-only, language, `language2`, `interests` chips via `set_profile_extra`, bio); interests show on profiles.
- Login screen (Chamet-style): purple landing with Google / 📱 phone / আরও অপশন (email, new account) + 18+/terms tick.
  Google (APK ≥ v1.0.18): `ReelsAndroid.googleSignIn(webClientId)` (Credential Manager, GetSignInWithGoogleOption) →
  `window.onGoogleSignIn(idToken, err)` → `sb.auth.signInWithIdToken({provider:'google'})`. `GOOGLE_WEB_CLIENT_ID` constant in app.js
  (set to the Web client of Google Cloud project "Default Gemini Project"; Android client there too). Needs Supabase Auth → Google provider enabled with the Web client ID/secret, and an Android
  OAuth client (package com.reelsenjoy.app + SHA-1 of reels-release.jks; add Play App Signing SHA-1 for the Play build).
  `handle_new_user` (google provider) fills name/avatar, user_private phone `google:<uid>`; no welcome form any more (owner's choice —
  users set gender/language/birth date in `#myprofile`; own profile "✏️ প্রোফাইল এডিট" opens `#myprofile`). `#onbForm` code kept but unused.
- Coin page (036, Chamet-style `#cashin/<g|r|h>`): purple header with balance, tabs **Google** (Play Billing, only in the Play build),
  **রিকমেন্ড** (bKash/Nagad offers + standard packs → cash-in form) and **টপ-আপ হেল্পার** (coin sellers, region filter, notice
  `settings.topup_helper_notice(_en)`). Play build hides bKash/helpers/seller CTAs/offer popup unless admin sets `play_show_helpers`
  (Play policy risk — default off). Packages: `play_products` (product_id = Play Console in-app product ID, coins, base_coins for the
  crossed-out number, badge 👍) edited on admin "Coin Sent" page; prices are set only in Play Console. Flow: APK `ReelsAndroid.playProducts(ids)`
  → `onPlayProducts`, `playBuy(productId, userId)` (obfuscatedAccountId = user id) → `onPlayPurchase({productId, token}|{error})` →
  edge function `play-purchase` (verify with Google Play Developer API using service account JSON in `private_config.play_service_account`,
  checks account id, `grant_play_purchase` idempotent per token, consumes) ; `playRestore()` on start re-sends unfinished purchases.
  Needs (owner TODO after Play account approval): create the app + in-app products in Play Console, Google Cloud service account with
  Play Console "View financial data / Manage orders" permission, put its JSON key in private_config. Refunds are not reversed yet.
- Monetization (040, admin "💎 আয়ের ফিচার" `#monetize/<pool|vip|store|boost|sponsor>`, `admin_monetize_stats`):
  - Reward pool: `pool_enabled` (default off) → daily `pool_pct` % of real new money (`_pool_revenue`: approved cash-in + Play purchases × coin price ×
    `play_net_pct`) + admin `admin_pool_extra` is split at 00:10 BD (cron `pool-settle` → `pool_settle()`) among viewers by that day's
    `viewer_daily_points` (≥ `pool_min_points`, cap `pool_user_cap_paisa`) as pending (`reward_pool`); table `reward_pools`. While on,
    `convert_points` raises POOL_MODE. App: `poolCard()` on #wallet and #rules (`pool_today`).
  - VIP: `vip_plans` (days, price_coins, daily_coins, points_bonus_pct, badge, color) bought with coins (`buy_vip`), `profiles.vip_until/vip_plan_id`,
    `claim_vip_daily` (free coins once a day), `_vip_bonus_pct` adds % in `claim_watch_reward`; badge `vipTag(p)`, app `#vip`.
  - Store: `store_items` (kind frame|entry|bubble, style = preset CSS key, price, days 0 = forever, vip_only) + `user_items`; `buy_item` (auto-equips),
    `equip_item`; equipped styles in `profiles.deco` {frame, entry, bubble}; cron `deco-expire` hourly. App `#store/<kind>`; `avatarD(p)` draws
    `.av.fr.fr-<style>` (Me, profile, chat, live host chip); chat bubbles `.bb-<style>`; `live_join` writes join body `fx:<style>[:vip]` →
    `entryHtml()` banner. New designs = add CSS + `STYLE_OPTS` in admin app.js.
  - Video boost: own published video 🚀 in feed → `boost_video(video, days)` (`boost_coins_per_day`, `boost_max_days`) sets `videos.boost_until`;
    `boosted_feed()` mixed into the main feed every `boost_every_n` slides with "🚀 প্রমোটেড".
  - Sponsor ads (direct deals): `sponsor_ads` (image in `photos` bucket, link, placement all|home|feed, ends_at, impressions/clicks via
    `sponsor_event`), admin CRUD `admin_save_sponsor/admin_delete_sponsor`; app: Home banner (`homeSponsors`) + feed slide every `sponsor_every_n`.
- Launch offer (042, admin "🚀 লঞ্চ অফার" `#launch/<locks|season|new|s<id>>`):
  - Income locks: `settings.income_locks` {views, likes, comments, watch, ads, posts, convert, upload} (true = locked, all locked at launch).
    `_wallet_move` skips positive moves of locked types via `_income_locked(type)` (actions still work, no money/points); `points_convert`
    raises INCOME_LOCKED. App: `locked(k)` / `soon()` show "🔒 শীঘ্রই আসছে" on #rules, #wallet, upload card; watch toast hidden. Referral, gifts,
    season prizes, welcome bonus (own switch) are never locked.
  - Seasons: `seasons` (prizes in taka arrays `creator_prizes`/`referral_prizes`, `weights` {watch, like, comment, share, video, referral,
    actor_cap}, min_videos, require_device, frame_days, boost_days, published), `season_excluded`, `season_winners`. `_season_scores` counts
    only other real users (active, APK device if require_device, no shared device with the creator), comments/shares once per video, each
    viewer capped at actor_cap points per creator; creator needs ≥ min_videos approved in the window. `_season_ranked`, `season_current()`
    (app: top 20 + me), admin `admin_seasons/admin_save_season/admin_delete_season/admin_season_board/admin_season_exclude/admin_season_pay`
    (after end: pays `season_prize` to earning, notifies, 👑 crown frame, boosts top-3 latest video). App: `seasonBanner()` on Home/#rules/#wallet,
    `#season/<creator|referral>`.
- Website + offer posts (043): `site/` (index.html, site.css, site.js, img/ = sample app screenshots) is a static bilingual page
  (`data-en` attributes, shares `localStorage.lang` with the app). It calls `site_info()` over REST with the publishable key:
  public settings (rates, withdraw rules, referral tasks, income_locks → "Coming soon"), current season (+ live top 5), last paid
  winners, active coin offers, `site_posts`, stats (shown only when ≥ 100 users). `site_posts` (kind offer|news, bn/en title & body,
  image in `photos`, link `#route` or https, show_app/show_site, pinned, starts/ends) edited on admin "🚀 লঞ্চ অফার" → "📢 অফার ও খবর"
  (`#launch/posts|pnew|p<id>`, `admin_site_posts/admin_save_site_post/admin_delete_site_post`, optional `admin_broadcast`).
  App: `app_offers()` → Home strip (`homeOffers`) + `#offers`; Settings links to #offers and the website; `get/` links to the site.
  Public URL: https://reelsenjoy.com (Cloudflare Worker, see Pieces).
- Website launch offers (059): `site/#launch` = user/host offer cards + trust points built by `launchOffers(S)` in site.js from site_info settings (all numbers live).
- Website editor (046, admin "🌐 ওয়েবসাইট" `#website`): only design 3 kept (owner's choice) — body class `t-c` (pink-orange festive); `site_theme` = c; `settings.site_texts` {notice (top ribbon), hero_tag/title/lead, *_title, faq ("q || a" per line),
  footer, whatsapp/facebook/youtube/tiktok/instagram, each text also `<key>_en`} applied to `[data-k]` elements by `applySite()` in site.js.
- Agents (044/045): owner wants NO apply option inside the app. People apply on the website (`site/#agent` form → `agent_web_apply(user_no, name,
  phone, area, plan)`, anon allowed, rate-limited, table `agent_applications`; `agent_apply` revoked). Admin "🧑‍💼 এজেন্ট" `#agents/<pending|approved|rejected|all|rules>`
  (`admin_agents`, `admin_agent_action` approve|reject|remove, agent_* settings). `profiles.agent_status/agent_since/ref_agent`; trigger `tg_ref_agent`
  marks a referral as agent-type when the referrer is an approved agent at that moment. `_referral_progress` then uses agent_* rules
  (window, active days + minutes, per-day photo/text/video posts on `agent_req_post_days` days, full watch/likes/comments/shares).
  `_check_referral` pays `agent_ref_bonus_paisa` and every `agent_target_refs` successes `agent_target_bonus_paisa` (`agent_target_bonus`).
  Admin `#agents/pending` lists web applications (`admin_agent_applications`, `admin_agent_application_action` → approve calls `admin_agent_action`).
  App: Me menu / #invite card only for approved agents; `#agent` for others only points to the website; approved = `my_agent()` dashboard
  (income rules with examples, code, link `get/?ref=<no>&agent=1`, stats, target bar, people + progress), profile badge 🧑‍💼.
- Growth (047): coins-only rewards (never withdrawable). Daily check-in `daily_checkins` + `checkin_status/daily_checkin` (7-day cycle
  `checkin_rewards`, streak resets after a missed BD day; popup once a day on app start before the offer popup, card on Me (only until done) and #rules).
  New-user checklist `starter_claims` + `starter_status/starter_claim(task)` (avatar, first published video, follow `starter_follow_need`, done bonus;
  shown for `starter_days` after signup). `bonus_need_device` (default on) = APK device required and one reward per phone (`_my_device`).
  Admin "🚀 লঞ্চ অফার" → `#launch/grow` (settings + `admin_growth_stats`). Video share page `v/?id=&ref=&lang=` (anon `public_video(id)`:
  published, non-premium only) plays a 15 s preview, then "watch in the app" → `get/`; app `videoLink(v)` builds it from `share_link` (get/ → v/).
- Wealth level & top-up commission (048): `_wallet_move` keeps `profiles.wealth_topup` (cash_in/play_purchase/seller_buy) and `wealth_spent`
  (all coin spending except seller sale/commission, admin adjust/grant); level = count of `settings.wealth_levels` (10 thresholds) ≤ max(both).
  App `wealthTag(p)` (gem badge, drawn inside `vipTag`), `#level/w` page; admin thresholds on `#launch/grow`. On cash_in/play_purchase,
  `_ref_topup_bonus` gives the referrer `ref_topup_pct` % (default 10) as coins (`ref_topup_bonus`, lifetime, skipped for same_device);
  setting on admin "🎁 রেফার"; `#invite` shows the rule.
- Visual style (049, owner chose mockup "style 3"): purple header block = `.page > h1` itself (full-width, `--band`; nothing else sits on purple — readability), white cards with soft
  shadow, orange→pink CTA (`--cta`), Inter for Latin + Hind Siliguri for Bengali. Emoji in UI text become line icons at runtime: `iconize()`
  in app.js (MutationObserver registered after i18n's, so translation happens first) maps `EICON` emoji → `<i class="ei ei-NAME">` (CSS mask
  icons at the end of app.css) and 🪙 → `<i class="coin">` (gold SVG). Skips `ESKIP` (translate="no", inputs, gifts, editor, stickers, captions,
  chat bubbles). Icon colour = `--icon`: default currentColor (same as the text); purple only in light list contexts (.li, .st-i, .me-menu, h2/h3 …). Icons are `<i-c>` elements so page CSS like `.x span`/`.x i` can't restyle them. Keep writing emoji in code; add new
  ones to `EICON` + an icon path in the generator if needed.
- Admin design (050): dark (default, navy-purple, glowing active nav) + light theme — `html[data-theme]`, sun/moon toggle `#themeTg`,
  localStorage `adminTheme` (set in a head script before paint). Colours via CSS vars in the "নতুন ডিজাইন" block of style.css (pills use
  `--pill-*`; never hardcode dark hex in new UI). `icons.js` = admin iconizer (same `<i-c class="ei ei-*">` icons as the app).
  Dashboard: hero with pending-work chips, KPI cards, SVG charts (`CH.line/bars/donut`, data from `admin_income_report` 60 days,
  `admin_user_type_counts`, `admin_analytics(30)`). Users page `#users/<all|user|host|seller|agent>` = Keeta-style monitor list (050: `admin_user_monitor(q,state,type,sort)`,
  `admin_user_state_counts(type)`, `_user_state(user)` = live|party|call|online (last_seen < 3 min; `track_time` now bumps last_seen)|offline|restricted;
  status dropdown with counts + chips, sort, auto-refresh 30 s; row → `#lookup/<user_no>`). Map (051): Leaflet 1.9.4 from unpkg (lazy) + CARTO tiles, `admin_user_map(type,state)` (approx
  location, deterministic jitter so pins don't overlap); split view ≥1100 px, phone toggle 📋/🗺 (localStorage `umonMode`). `userCard` kept but unused.
  Coins page `#coins` = hero stats + tabs send/price/offer/play/hist (sessionStorage `coinTab`).
  Admin-only English lives in `i18n-admin.js` (`window.I18N_EXTRA` map + `I18N_EXTRA_PRE` regex rules, loaded before i18n.js only in admin);
  new admin UI text → add there. Admin en crawl must show 0 Bengali except user/admin-written content.
- User blocking (049, Play UGC rule): `user_blocks`, `block_user(user, on)`, `my_blocks()`, `_is_blocked(a,b)` checked in `send_message`/`call_start`
  (raises BLOCKED); blocking also removes follows both ways. App: profile ⋯ (`userMenu`: report user via `report_content('user',…)` / block),
  Settings → `#blocked` list; `rpc()` drops rows whose user_id/creator_id/… is in `BLOCKED` (loaded in `start()`).
  Play review account: reelsenjoy.app+review@gmail.com (user_no 100009, 2000 coins) — password is in Play Console "Sign in details".
- Device admin (061): admin "📱 ডিভাইস" per account ✅ অ্যাপ্রুভ (`device_approvals`; `register_device` and `admin_device_action('approve')` give that account its own hash `<base>:a<uid8>`, so every same-phone rule treats it as a separate phone), অ্যাপ্রুভ বাতিল, ⛓ জেল (`admin_jail_now`), 🗑 ডিলেট (`admin_delete_account`); per phone 🔄 রিসেট (`admin_device_action('reset')` deletes its `user_devices` rows + approvals, clears `referral_blocked='same_device'`). `admin_devices` groups by `split_part(device_hash, ':', 1)`.
- Device ban (063): device page "🗑 ডিলেট" = `admin_device_action('ban')` (status banned + ban_reason, posts/name kept, push tokens removed; the account's device row moves to `<base>:x<uid8>` so it no longer counts on that phone; `register_device` keeps banned accounts on the `:x` hash), "↩️ ফেরত চালু করুন" = unban. `_check_referral` same-phone block now only when ANOTHER account used the phone EARLIER (`other.first_seen < mine.first_seen`) → one referral per phone, the first active account.
- Back-scroll: `holdScroll(el, y)` keeps the restored scroll for 5 s while lists load (stops on touch).
- Admin boost (061): `admin_boost_video(id, days)` (free, 0 = stop) from Videos page (tab 🚀 বুস্টেড) and lookup page (also approve/reject/delete/restore there); shows in `boosted_feed` (non-premium only).
- Pull to refresh (062): pull down at the top of any page (`.ptr` indicator, skips forms/live/chat pages in `NO`) → `refreshNow()` (drops PAGE_CACHE entry + `route()`). Main feed (`mixIn`) shuffles each batch, unseen first (`seenV` in localStorage, `markSeen` in `activate`), first batch 20.
- Feed swipe (057): on `#feed`/`#following` a horizontal swipe on the player switches tabs (right → Following, left → For You).
- Me cover readability: `.me-head.has-cover` uses a dark overlay + white text with shadow.
- Text post design (057): `posts.bg` = "<bg>.<font>.<textColour>.<align>.<fx>" (old posts = bg key only); `BGS` (gradients g1–g18, solids s1–s6,
  patterns p1–p6), `TFONTS` (Google fonts loaded lazily by `ensureTFont`), `TCOLS`, `TFX` (shadow/outline/neon/box/highlight); `tStyle(bg)` renders
  every text card. Composer `composeText` has tabs রং/ফন্ট/লেখার রং/ইফেক্ট + align + 🎲 random; last design kept in localStorage `tDesign`.
- First-login choice (057): `profiles.start_choice_done` (existing users true) → app `startChoice()` gate (#startGate, CSS prefix `sg-` — `.st-card` is the starter-tasks card): User/Host cards → rules
  from `settings.start_rules_user/_host(_en)` (one per line) → `choose_start_type(p_type)` (host = `set_account_type('host')`, admin approval).
- Me banners (057): `settings.me_banners` = [{t,t_en,s,s_en,badge,badge_en,link,style,img,ends,on,wide}] replaces the VIP/Decorate pair when
  non-empty (`meBanners()`/`meBannerHtml()`; English users only see banners with English text). Admin "🖼 অ্যাপ ব্যানার" `#banners` edits
  banners (colour presets `BAN_ST`, image upload to `photos`, order, end date) and the start rules.
- My Beans (058): hosts' gift/call income (types gift_received/call_earning, incl. premium unlock) is redirected inside `_wallet_move` to bucket
  `beans` (`wallets.beans` = Beans×100) when `beans_enabled`: gross coins (gift_transactions.total_coins / calls.rate_coins per minute, else
  share ÷ coin price) ÷ `coins_per_bean` (100) — host gift/call % no longer applies. 1 Bean = `bean_value_paisa` (৳1–1.20, admin). Beans count as
  taka only from `beans_min_withdraw` (1000): `_beans_usable_paisa`; `request_withdraw` auto-converts needed Beans (ledger `beans_convert`);
  `withdraw_eligibility` returns balance incl. Beans + level; `my_beans()`. Users never convert coins (owner chose "hosts only" — bought coins
  must never cash out). App: host Me card "My Beans" (`beansCard`), wallet/withdraw show Beans. Admin settings on `#rules/host`.
- Fast withdraw (058): `settings.withdraw_levels` [{refs, days}] by count of successful referrals (`referral_qualified_at`) →
  `_withdraw_level(user)` replaces `withdraw_cooldown_days` (days may be fractional, 0 = any time). App `wdLevelCard()` on #withdraw; admin textarea on `#rules/host`.
- Offers & targets (059, admin "🎯 অফার ও টার্গেট" `#targets/<set|top|fast>`; other income stays 🔒 via income_locks — owner: "customers first"):
  - Referral: referrer ৳10 (`referral_bonus_paisa` / `host_referral_bonus_paisa`), new user ৳10 (`ref_new_user_paisa`) or ৳15 when a host invited
    (`host_ref_new_user_paisa`), host +৳40 every 3 successes (`host_ref_every_n/_paisa`); new user must post `ref_req_video_posts`/`ref_req_text_posts`
    (2/2, other ref_req_* = 0) and the referrer too (`ref_referrer_min_videos/texts`, payout waits until met) — in `_check_referral`. referral_tiers disabled.
  - Daily target (coins, once per BD day, one per phone): `settings.daily_task_user/host` {video_post,text_post,watch,like,comment,tlike,tcomment,share,coins}
    → `_daily_task_items`, `daily_task_status()`, `daily_task_claim()` (`daily_task_claims`, ledger `daily_task_reward`). App `dailyTaskCard()` on #rules + compact on Me.
  - Host engagement coins: triggers on likes/comments/shares → `_host_engage` pays the host `host_engage.coins` (20) once per actor/video/kind, daily cap,
    only actors that are the first account on their phone (`_device_primary`) and not on the host's phone (`host_engage_rewards`).
  - Top referral bonus every 10 days (1–10, 11–20, 21–end): `ref_top_user` (top 10) / `ref_top_host` (top 5) {top, tiers[{refs, active %, paisa}]};
    active = qualified referrals; `_ref_top_board`, cron `ref-top-settle` 00:30 BD → `ref_top_settle()` (`ref_top_periods`, `ref_top_awards`), `my_ref_top()`
    (app `refTopCard` on #invite), `admin_ref_top`.
  - Withdraw: everyone `withdraw_cooldown_days` 15; admin turns on per-user fast withdraw on the lookup page (`admin_set_fast_withdraw`, `profiles.fast_withdraw`)
    → `fast_withdraw_days` (1) and ⚡ requests sorted first on admin withdrawals.
  - Free coins: `wallets.bonus_coins` tracks reward coins (checkin/starter/upload/vip_daily/ref_topup/daily_task/host_engage). Accounts that are not the
    first account on their phone cannot spend free coins on gift_sent/call_charge/seller_sale (`BONUS_COINS_GIFT` "❌ রিজেক্ট") — bought coins still gift; free coins
    still work for premium etc. (owner's rule).
- Themes (060): Original (default) · Light · Dark for app and website — `html[data-theme]` set before paint from localStorage `theme` (head script).
  App: Settings → 🎨 থিম picker (`THEMES`, `setTheme`, `darkBars()` wraps `setDarkBars` so dark theme keeps dark status bars); website: nav 🎨 button cycles.
  CSS: `app/theme-base.css`, `site/theme-base.css` (vars + hand fixes) and `*/theme-dark.gen.css` generated by `python3 tools/theme_gen.py <src.css> <out.css> [--skip=…]`
  (re-run after big CSS changes; app uses --skip=.full,.lv-,.live,.party,.slide,.feed,.stv,.call,.room,.pk-,.gift,.upd-gate,.ved). Check contrast per theme with a crawl.
  Liquid Glass was tried and removed (owner didn't like it). ALWAYS syntax-check app.js as a module before pushing (`cp app/app.js /tmp/x.mjs && node --check /tmp/x.mjs`) — a bad template once broke app start.
- Declined: stock/AI photos of attractive women/men presented as app users (misleading fake users). Use only real, consenting people's photos.
- Not built on purpose: Chamet "BIG WIN"/"City PK" coin games (betting).
- Declined: real-money betting games in live (coins are bought with money and earnings withdraw → gambling, illegal in BD/KSA,
  banned by Play). Offer free point games instead. Call moderation must cover the whole call, not only the first minutes.

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
admin RPCs call `_require_admin()`. `anon` cannot execute any function except `site_info()` (read-only public info for the website), `agent_web_apply()` (website agent form) and `public_video(id)` (share page).
