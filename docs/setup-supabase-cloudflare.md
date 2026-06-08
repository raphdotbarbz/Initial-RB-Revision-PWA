# Supabase + Cloudflare Start Guide

## 1. Run the database SQL

In Supabase SQL Editor, run:

1. `/Users/raphbarberis/rb-revision-pwa/db/schema.sql`
2. `/Users/raphbarberis/rb-revision-pwa/db/rls.sql`

This creates:

- `profiles`
- `user_snapshots`
- the longer-term content and analytics tables
- row-level security for the first sync tables

## 2. Turn on email auth

In Supabase:

- go to `Authentication`
- enable `Email`
- keep magic links enabled

## 3. Set your site URL and redirect URLs

For local testing:

- Site URL: `http://127.0.0.1:4173`
- Redirect URL: `http://127.0.0.1:4173`

For Cloudflare Pages production, also add:

- `https://<your-project>.pages.dev`
- `https://<your-custom-domain>`

## 4. Add your public client config

Open:

- `/Users/raphbarberis/rb-revision-pwa/js/config.js`

Fill in:

```js
export const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

Notes:

- use the **anon/public** key, not the service role key
- the anon key is meant for browser clients

## 5. Test locally

Run:

```bash
cd /Users/raphbarberis/rb-revision-pwa
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173
```

Go to `Settings`:

- send yourself a magic link
- open the link on the same device
- sign in
- use `Push to cloud`
- on another device, sign in and use `Pull from cloud`

## 6. Prepare the app bundle

This project now includes:

- `/Users/raphbarberis/rb-revision-pwa/build.sh`

Run:

```bash
cd /Users/raphbarberis/rb-revision-pwa
bash build.sh
```

That creates:

- `/Users/raphbarberis/rb-revision-pwa/dist`

Cloudflare Pages should deploy that `dist` folder.

## 7. Deploy to Cloudflare Pages

Recommended path: Git integration.

### GitHub

If you have not already, create a GitHub repo and push this folder:

```bash
cd /Users/raphbarberis/rb-revision-pwa
git init
git add .
git commit -m "Initial RB Revision PWA"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

### Cloudflare Pages dashboard

Create a new Pages project from that GitHub repo and use:

- Framework preset: `None`
- Production branch: `main`
- Build command: `bash build.sh`
- Build output directory: `dist`
- Root directory: leave blank unless the app is inside a larger monorepo

Why this setup:

- the app is a static HTML/PWA project
- `build.sh` copies only the deployable assets into `dist`
- this keeps docs, scripts, and local artifacts out of production

After the first deploy, you will get a stable `*.pages.dev` URL.

## 8. Update Supabase Auth URLs for production

In Supabase Auth URL configuration, add:

- your local laptop URL: `http://127.0.0.1:4173`
- your local phone test URL: `http://<your-mac-ip>:4173`
- your Cloudflare Pages URL: `https://<your-project>.pages.dev`
- your final custom domain if you add one

Important:

- `localhost` on your phone points to the phone itself, not your Mac
- if you ever see a magic link trying to open `localhost:3000`, your Auth URL config is still pointing at an old dev URL

## 9. What sync covers right now

Current beta sync:

- progress
- module goals
- daily goals
- filters and local settings

Not synced yet:

- Anthropic API key
- full normalized question-attempt tables
- AI conversation history
- admin imports

## 10. Recommended next build step

After auth and snapshot sync are working, the next good step is:

1. move AI behind a server-side endpoint
2. replace snapshot sync with normalized Supabase tables for attempts, reviews, goals, and readings
3. add reading sync for CAIA
