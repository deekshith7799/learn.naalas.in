# DBA Academy

Team learning site for PostgreSQL, MySQL and MongoDB, with invite-only login, progress tracking, a hands-on practice lab and an admin page.

**Stack:** React (Vite) · Node/Express · PostgreSQL · Caddy (automatic HTTPS) · Docker Compose

## What you get
- Login with two ways to get an account: the admin adds people (temporary password, changed at first login), or team members sign up themselves on the login page using a team code.
- 3 database sections (7 lessons each) with analogy, key points and copy-ready commands.
- Compare page: the same DBA task in all three databases, with filter.
- **Practice lab:** every learner gets a private sandbox on real PostgreSQL, MySQL and MongoDB servers, loaded with a sample online shop, with examples and exercises (hints and solutions). They type queries in the browser and see the results.
- Per-person progress saved in PostgreSQL; admin page shows team progress.

## Accounts and sign-up
- **Admin account:** created once, on the very first start, from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Changing those later does not change an existing admin (use `./academy reset-password <email>`). Nobody becomes an admin by signing up; an existing admin promotes them (`./academy set-role <email> admin`).
- **No default logins:** there is no built-in username or password. The server refuses to start (and says why in `docker compose logs server`) while `JWT_SECRET`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` or `SIGNUP_CODE` are still the `change-this...` / `you@example.com` placeholders from `.env.example`, or too short. `deploy/ec2-setup.sh` stops at the same point before starting anything.
- **Team sign-up:** the login page shows **Create an account** when `SIGNUP_CODE` is set in `.env`. People enter name, email, a password and the team code, and get a learner account straight away. Share the code only with your team. Wrong codes are rate-limited (20 tries per hour per address).
- **Turn sign-up off:** leave `SIGNUP_CODE=` empty and restart (`docker compose up -d server`). Then only the admin can add people.
- **Change the code:** edit `SIGNUP_CODE` in `.env`, then `docker compose up -d server`. Existing accounts are not affected.

## Practice lab
Open **Practice** in the top bar and pick an engine. Each learner has their own copy of the sample data (200 customers, 40 products, 5,000 orders) in each engine, so they can create tables, change data and break things safely. **Reset sandbox** restores the sample data.

| | Language | Also understands |
|---|---|---|
| PostgreSQL | SQL | `\dt`, `\d table`, `\di` |
| MySQL | SQL | `SHOW`, `DESCRIBE`, `EXPLAIN` |
| MongoDB | mongosh style: `db.orders.find({...})`, `aggregate([...])`, `insertOne`, `updateMany`, `createIndex`, `explain("executionStats")` | `show collections`, `help` |

Safety limits (all enforced on the server, learners cannot switch them off):
- 5 second limit per query, with a hard stop at 8 to 15 seconds even if the learner removes the limit; first 200 rows shown; 20 statements per run; 60 runs per minute.
- Each sandbox is capped at 128 MB and is reset to the sample data if it grows past that.
- A learner has their own database account on each engine, with no access to anyone else's data, to the server's files or to server settings.
- The three lab database servers sit on an internal Docker network: no published ports, no internet, no route to the app database.
- MongoDB runs with auth on and server-side JavaScript (`$where`, `$function`) off.
- Deleting a user (Admin page or CLI) also removes their sandboxes.

Needs `LAB_ADMIN_PASSWORD` in `.env` (letters and digits only). `deploy/ec2-setup.sh` generates it for you.

## Run locally (Windows with Docker Desktop, or any machine)
```bash
cp .env.example .env        # edit the passwords; for a local test set DOMAIN=http://localhost
docker compose up --build
```
Open http://localhost and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (the admin account is created on the first start only). To test sign-up, set `SIGNUP_CODE=` to any word in `.env`.
The first start downloads the PostgreSQL, MySQL and MongoDB images (about 1 GB) and needs roughly 3 GB of free memory for Docker. Already have an older `.env`? Add a `LAB_ADMIN_PASSWORD=...` line, otherwise `docker compose` stops with a message asking for it.

Dev mode without Docker (needs a local PostgreSQL; the lab also needs PostgreSQL, MySQL and MongoDB servers, see `LAB_*_HOST` in `server/src/lab/common.js`):
```bash
cd server && npm install
DATABASE_URL=postgres://user:pass@localhost:5432/academy JWT_SECRET=dev-secret-0123456789 ADMIN_EMAIL=me@mydomain.com ADMIN_PASSWORD=my-admin-pass-1 LAB_ADMIN_PASSWORD=labpass1 npm run dev
cd client && npm install && npm run dev      # http://localhost:5173
```

## Deploy on an Ubuntu EC2 instance
1. **Domain:** buy one (Route 53, GoDaddy, Namecheap).
2. **Server** (pick one):
   - *Console:* launch Ubuntu 22.04 or 24.04, **`t3.medium` (4 GB RAM) or bigger**, 30 GB disk. Security group inbound: 22 (your IP only), 80 and 443 (anywhere). Allocate an Elastic IP and attach it.
   - *Terraform:* `cd infra && terraform init && terraform apply -var key_name=<your-key-pair> -var ssh_cidr=<your-ip>/32`. It outputs the server IP.
3. **DNS:** add an **A record** (`@` or `learn`) pointing to the server IP. Wait until it resolves.
4. **Copy and set up:**
   ```bash
   scp -i key.pem dba-academy.zip ubuntu@<server-ip>:~
   ssh -i key.pem ubuntu@<server-ip>
   unzip dba-academy.zip && cd dba-academy
   bash deploy/ec2-setup.sh      # installs Docker, adds swap, creates .env with random secrets
   nano .env                     # set DOMAIN, ADMIN_EMAIL, ADMIN_PASSWORD
   bash deploy/ec2-setup.sh      # builds and starts everything (6 containers)
   ```
   Caddy gets a free HTTPS certificate automatically once DNS points to the server and ports 80/443 are open.
5. Open `https://yourdomain.com` and sign in as the admin. The script prints the **team sign-up code** at the end (also in `.env`): give it to your team, and they create their own accounts from the login page. You can still add people from **Admin**.

**Always running.** Three layers keep the site up without you:
1. Every container has `restart: unless-stopped` and Docker is enabled at boot, so everything comes back after a crash or an EC2 reboot.
2. The API has a health check (`/api/health`, which also tests the database). `./academy status` shows it.
3. `deploy/ec2-setup.sh` installs a watchdog (cron, every 5 minutes, log in `/var/log/dba-academy-watchdog.log`). It starts any container that stopped and restarts the API if it is unhealthy. For maintenance, `touch deploy/.paused` stops it from interfering; delete that file to resume.

Container logs are capped (3 files of 10 MB each per container), so they cannot fill the disk. To confirm after a reboot: `./academy status` (or `sudo docker compose ps`).

**Update later:** upload the new zip, `unzip -o`, then `sudo docker compose up -d --build`. Data is kept in Docker volumes.
**Logs:** `sudo docker compose logs -f server` (lab errors show up here as `[lab:...]`).
**Lab says "not reachable":** run `sudo docker compose ps`; `pg-lab`, `mysql-lab` and `mongo-lab` must be Up. MySQL and MongoDB take 20 to 40 seconds to start on first boot.

## Admin CLI
Run from the project folder (Windows: `.\academy.ps1 ...`, Ubuntu: `./academy ...`; first time on Ubuntu `chmod +x academy`).

| Command | What it does |
|---|---|
| `users` | List users with progress and last activity |
| `add-user <email> <name> [--role admin]` | Create a user, prints a temporary password |
| `reset-password <email>` | New temporary password |
| `set-role <email> <admin\|learner>` | Change role |
| `delete-user <email>` | Delete a user, their progress and their practice sandboxes |
| `progress <email>` | Lessons one person has completed |
| `stats` | Team totals, 7-day activity, most-completed lessons |
| `db-status` | PostgreSQL version, size, uptime, connections, table sizes |
| `backup` / `restore <file>` | Dump or restore the whole app database |
| `status` | Container list plus an API health check (exits with an error if the API or its database is down) |
| `psql` / `logs` | Open psql inside the app DB container / follow server logs |

After updating the code run `docker compose up -d --build server` so the CLI is inside the container.

## Edit the content
- Lessons and compare rows: `client/src/content.js`. Add a lesson object, rebuild (`docker compose up -d --build web`), and it appears with progress tracking. Lesson `id`s must stay unique and stable.
- Practice-lab examples and exercises: `client/src/labContent.js`. The sample data itself is generated in `server/src/lab/seed.js` (same data in all three engines).

## Backups and safety
- User data lives in the `pgdata` Docker volume. Back it up: `docker compose exec db pg_dump -U academy academy > backup.sql`
- Practice sandboxes (`pglab_data`, `mysqllab_data`, `mongolab_data`) are throw-away: learners can reset them, so they do not need backups.
- Keep `.env` private. Changing `JWT_SECRET` signs everyone out (sandbox logins re-sync automatically).
- Login is rate-limited and passwords are hashed with bcrypt.
# learn.naalas.in
