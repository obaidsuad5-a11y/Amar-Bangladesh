# Amar Bangladesh — International Newsroom Edition

A full-stack Bangla/English newsroom built on the existing project architecture: HTML/CSS/Vanilla JS, Node.js 18+, Express and MongoDB/Mongoose. Existing editorial workflows remain in place; this upgrade adds live updates, AI editorial assistance, video/photo links, moderated comments, web push, advertisement campaigns, optional Cloudinary uploads and MongoDB dump tooling.

## Stack
- Frontend: HTML5, responsive CSS, Vanilla JavaScript, Web Push service worker
- Backend: Node.js 18+, Express 4
- Database: MongoDB + Mongoose
- Authentication: bcrypt + JWT; Admin, Editor and Reporter roles
- Optional integrations: Cloudinary, OpenAI-compatible AI endpoint, Web Push (VAPID)

## Requirements
- Node.js 18 or newer
- MongoDB local or MongoDB Atlas
- Optional: MongoDB Database Tools (`mongodump`) for manual backups

## Install and run (Windows PowerShell)
1. Extract the ZIP. Open PowerShell in the `Amar_Bangladesh_Full_Stack` folder (the folder containing `package.json`).
2. Install packages:
   ```powershell
   npm install
   ```
   If PowerShell blocks `npm.ps1`, use `npm.cmd install` and `npm.cmd run dev` instead. Alternatively, use Command Prompt.
3. Create `.env` from the sample:
   ```powershell
   Copy-Item .env.example .env
   ```
4. Edit `.env`. At minimum set:
   - `MONGODB_URI` to your MongoDB connection string
   - `JWT_SECRET` to a random secret of at least 32 characters
   - `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD`
   - `PUBLIC_URL` to the production website URL after deployment
5. Create the first admin:
   ```powershell
   npm.cmd run seed:admin
   ```
6. Start the app:
   ```powershell
   npm.cmd run dev
   ```
7. Open `http://localhost:5000` and `http://localhost:5000/admin.html`.

Generate a JWT secret in PowerShell:
```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

## New feature setup

### 1. Live news
Sign in to `/admin.html` as Admin or Editor. Use **International Desk → Live Update** to publish a live update. Public updates appear on the homepage. This is a live-update feed, not a real-time TV broadcast or streaming server.

### 2. AI editorial assistant
Configure an OpenAI-compatible Chat Completions API in `.env`:
```env
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_API_KEY=your_provider_key
AI_MODEL=gpt-4o-mini
```
The assistant offers headline suggestions, summaries, proofreading and translation. It is optional, consumes the provider's API quota, and output must be reviewed by an editor before publication.

### 3. Video news and photo gallery
Add public HTTPS video or image URLs from the dashboard. For video, use a stable hosted video URL (YouTube/Vimeo links can be linked; this starter does not provide video transcoding or hosting). Photos use the same gallery link model.

### 4. English + Bangla
The public site has a Bangla/English interface toggle. Editors can provide English headline, summary and article body in addition to Bangla. If English content is blank, the site falls back to Bangla; it does not automatically translate articles unless the editor uses the AI translation helper and saves the reviewed translation.

### 5. Comments and users
Visitors can submit comments; they are hidden until Admin/Editor approves them in the dashboard. Staff users are created by Admin. Reader self-registration (`POST /api/auth/register`) and authenticated profile endpoints (`GET/PATCH /api/profile`) are included. Comment submissions currently accept a display name and are not yet tied to verified reader identity.

### 6. Google News / SEO
The app serves `robots.txt`, `sitemap.xml`, canonical production base URLs and NewsArticle JSON-LD on opened articles. Set `PUBLIC_URL` to the exact HTTPS domain. Google News inclusion is decided by Google and cannot be guaranteed by code; ensure transparent publisher details, editorial policies, original reporting, accurate dates and crawlable article pages. For production, a dedicated article URL route (rather than query-string URLs) is recommended.

### 7. Push notifications
Generate VAPID keys:
```powershell
npx web-push generate-vapid-keys
```
Put both values in `.env`:
```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:editor@your-domain.com
```
Deploy over HTTPS (required by browsers), open the public site, and click **Alerts** to subscribe. Admin/Editor can send a push from the dashboard. Push delivery depends on browser permission and device support.

### 8. Advertisement management
Admin can create campaigns with an HTTPS destination, optional image URL, placement and active status. Public ad listing, impression and click counters are included. This is direct-sold ad inventory management, not an automatic Google AdSense integration. Validate advertiser creatives and comply with local advertising laws.

### 9. Cloud image storage
Create a Cloudinary account and set:
```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```
Use authenticated `POST /api/uploads/cloud` with multipart field `image`. The original `/api/uploads` local upload endpoint remains available for development. Do not commit credentials.

### 10. Database backups
For local/manual backups install MongoDB Database Tools, then run:
```powershell
npm.cmd run backup
```
This creates a compressed archive under `backups/` (excluded from Git). For managed cloud backup, enable automated backups/snapshots in MongoDB Atlas for the cluster; test restoration periodically. Cloudinary stores media separately, so configure its retention/export policy too. A local dump command is not an automatic off-site backup service.

## Deployment (Render)
1. Push the project to a private GitHub repository. Never upload `.env`, database dumps or secrets.
2. Create a Render **Web Service** connected to the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables from `.env` in Render's Environment settings. Set `NODE_ENV=production`, Atlas `MONGODB_URI`, strong `JWT_SECRET`, `PUBLIC_URL=https://your-domain`, and `CLIENT_ORIGIN=https://your-domain`.
6. Add the optional integration variables only when configured.
7. Ensure the Render service uses a persistent external MongoDB and Cloudinary/S3 for media; ephemeral local disk may be cleared on redeploy.
8. After deployment, test `/api/health`, public homepage, login, news approval, comments, media and push over HTTPS.

## Important API additions
- `GET /api/live`, `POST /api/manage/live`, `DELETE /api/manage/live/:id`
- `GET/POST /api/news/:id/comments`
- `GET /api/manage/comments`, `PATCH /api/manage/comments/:id`
- `GET /api/media`, `POST /api/manage/media`, `DELETE /api/manage/media/:id`
- `GET /api/ads`, `POST /api/manage/ads`, `GET/PATCH /api/manage/ads`, `POST /api/ads/:id/click`, `POST /api/ads/:id/impression`
- `POST /api/ai/assist`
- `GET /api/push/public-key`, `POST /api/push/subscribe`, `POST /api/manage/push`
- `POST /api/uploads/cloud`

## Production checklist / limitations
- This is a substantial starter upgrade, not a third-party security audit or turnkey enterprise newsroom. Test on a staging deployment before going public.
- AI, Cloudinary and Web Push require your own provider credentials. Their free tiers/quotas and terms may change.
- Video is linked/embedded as external media; no live streaming encoder or CDN video pipeline is bundled.
- English translations are editor-entered or AI-assisted, not auto-published.
- Comments are moderated but currently use display names without verified reader accounts.
- Ad management is direct campaign tracking; no ad network integration or billing is included.
- Configure Atlas automated backups and restore drills; local `npm run backup` is manual.
- Add email verification, password recovery, CAPTCHA, CSRF strategy if moving auth to cookies, audit log retention, data retention policy and a formal privacy/copyright workflow before handling large public traffic.
- Run `npm audit` and resolve dependency advisories before production.
