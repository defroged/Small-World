# SMALL WORLD

A self-hosted recreation of the main [SMALL WORLD website](https://www.smallworld.fun/), with a real, database-backed Japanese admin area for **Lesson Report**, **お知らせ**, and **Word Rhythm**.

The original logo, ladybirds, yellow wood background, Chelsea Market typeface, six-photo slideshow, public copy, prices, and gallery photographs are included locally. There is no dependency on Wix to render those assets.

## Start locally

Requires **Node.js 24 or newer**.

```sh
npm ci
cp .env.example .env
npm run admin
npm start
```

The admin command asks for a name, email address, and a new password of at least 12 characters. Password input is hidden. No default administrator or password is bundled. Run the same command with the same admin email to reset its password and revoke its sessions.

Open `http://localhost:3000` for the site and `http://localhost:3000/admin` for administration. `npm run dev` restarts the server when server files change.

## 管理画面の使い方

1. `/admin` にログインし、**新しい記事を書く** を選びます。
2. **Lesson Report / お知らせ / Word Rhythm** のいずれかを選びます。
3. タイトルと本文を書き、必要に応じて画像・音声・動画を追加します。レッスン日、クラス名、カバー画像も設定できます。
4. **下書き保存**、**プレビュー**、**公開する** を選びます。
5. 公開範囲は初期状態で **保護者限定** です。一般公開すると、ログインしていない人も記事と添付ファイルを閲覧できます。
6. 一般公開の「お知らせ」で **ホームの News に表示** を選ぶと、ホームページにも掲載されます。

変更前の内容は編集履歴に残り、下書きとして復元できます。アーカイブした記事は非表示になり、記事一覧のフィルターから再編集・再公開できます。別の画面で同じ記事が変更された場合は上書きを防ぎます。

### 保護者

**保護者** 画面で名前とメールアドレスを入力すると、7日間有効の招待リンクを作成できます。リンクを保護者に渡すと、ご自身でパスワードを設定できます。メールの自動送信は行いません。

パスワードを忘れた保護者には **招待・再設定リンク** を発行します。**無効にする** を選ぶと、その保護者は即時にログアウトされ、限定記事と添付ファイルにアクセスできなくなります。

### お問い合わせ

Contact フォームから送られた内容は、管理画面の **お問い合わせ** に保存されます。メール転送は未設定です。定期的に管理画面をご確認ください。自動返信や外部サービスへの送信はありません。

### Word Rhythm

本文の **画像・音声** から MP3・M4A・OGG・WAV 音声を追加すると、記事内で再生できます。MP4動画にも対応します。アップロードは1ファイル25MBまでです。

## Public routes

| URL | Page |
| --- | --- |
| `/` | Home, About Us, opening hours, News |
| `/classes` | Course & Price |
| `/gallery` | Gallery with accessible photo lightbox |
| `/access` | Address, telephone, Google map |
| `/contact` | Contact form |
| `/parents` | Protected parent portal |
| `/blog` | Protected News & Reports index and search |
| `/blog/categories/lesson-report` | Lesson Report |
| `/blog/categories/お知らせ` | お知らせ |
| `/blog/categories/word-rhythm` | Word Rhythm |
| `/post/:slug` | Article; access follows its visibility setting |
| `/admin` | Administrator login and editor |

## Hosting

This is a **Node.js server**, not a static GitHub Pages website. It needs a persistent filesystem for its SQLite database and uploaded files. Use a Node/Docker host with a persistent disk, or a VPS. Ephemeral/serverless filesystems are not suitable for this configuration.

For a production deployment:

- Set `NODE_ENV=production` and `PUBLIC_URL` to the final HTTPS origin.
- Terminate HTTPS at a trusted reverse proxy. Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy sits directly in front of the application.
- Mount a durable directory at `DATA_DIR`. Run the application as an unprivileged user.
- Create the first admin with `npm run admin` on that host.
- Keep regular private backups of both the database and uploads.

`PUBLIC_URL` is also used for origin validation, sitemap links, and parent invitation links. It must match the URL visitors use. Production startup rejects an HTTP origin.

### Docker

```sh
docker compose up -d --build
docker compose exec website npm run admin
```

The supplied Compose file binds port 3000 to loopback, suitable for a local preview or a reverse proxy on the same machine. The named `smallworld-data` volume preserves posts, accounts, sessions, enquiries, and uploads across container restarts. Set the production environment values before exposing it through HTTPS.

### Backups

```sh
npm run backup
```

This uses SQLite's online backup API, then copies uploads into a timestamped `backups/` directory. Media files are immutable, so copying after the database snapshot retains every file referenced by the snapshot. Keep backups private. To restore, stop the application, replace the database and uploads directory in `DATA_DIR`, remove stale SQLite `-wal`/`-shm` sidecars from the stopped instance, and restart. Do not overwrite a running database.

The admin's article export is a portable JSON export of article records only. It does not replace a full backup of uploaded files, accounts, and enquiries.

## Data and security

- SQLite data lives in `data/smallworld.sqlite`; uploads live in `data/uploads/`. Both are ignored by Git.
- Passwords are scrypt hashes. Sessions are opaque random tokens stored hashed in the database, with `HttpOnly` / `SameSite=Lax` cookies (`Secure` in production).
- State-changing requests require CSRF tokens; browser origins are checked.
- Login and enquiry submissions are rate limited. No public admin-registration endpoint exists.
- Blog HTML is sanitized on the server. Executable markup and arbitrary remote media URLs are removed.
- Migrated media is restricted to the original site's exact Wix image/video CDN hosts; arbitrary remote media is rejected.
- Uploads are type-checked from file signatures. Uploaded private/draft media requires authorization; simply knowing its URL does not grant access.
- Member-only posts never appear in the public sitemap. Shared/private pages and uploads are served with `Cache-Control: private, no-store`.
- Archives and revision history provide recovery without permanently deleting posts.
- Database files, credentials, backups, and source-site member records must never be committed to this public repository.

## Verification

```sh
npm run check
npm test
```

The integration suite verifies original public routes, authentication, CSRF, all three post categories, publishing and member visibility, XSS handling, concurrent-edit protection, archives and restoration, uploads, parent invitations and revocation, contact enquiries, exports, and database persistence. GitHub Actions runs the same checks on pushes and pull requests.

## Importing the protected archive

Historical member posts are deliberately excluded from Git because this repository is public. Place the private export at `data/imported-posts.json`, then run:

```sh
npm run import:posts
```

The importer validates each category, sanitizes the article HTML, restricts media to the original Wix CDN, forces every imported article to **保護者限定**, and safely updates matching slugs when re-run. Back up the database after import. Never commit the source export or resulting SQLite files.

## Original site and migration scope

The recreation uses the main publicly navigable pages at `smallworld.fun`, inspected on 16 September 2026. The protected archive was inspected with an authorized member session and 81 posts from 16 September 2025 through 4 September 2026 were prepared for private import: 46 Lesson Reports, 11 notices, and 24 Word Rhythm posts. Because this GitHub repository is public, that private export and its database are not committed. The replacement admin and member portal are new implementations. The two public Home announcements are seeded without invented publication dates.

Wix member passwords, social-login configuration, billing, and hidden draft/template pages are not copied. A Wix sign-in does not configure the new website: create new local accounts and invite parents when deploying.

Original public asset provenance is recorded in `docs/asset-sources.json`. Those brand and school-photo assets remain the property of their respective owners and are included for this requested school-site migration.
