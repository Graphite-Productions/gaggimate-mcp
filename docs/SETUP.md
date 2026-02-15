# Setup Guide

Step-by-step instructions to deploy the GaggiMate Notion Bridge on your TrueNAS SCALE NAS (or any Docker host on your LAN).

## Prerequisites

- **GaggiMate** espresso machine on your local network with a known IP address
- **Notion** account with a workspace (Notion AI optional but recommended for dial-in)
- **Docker host** on the same LAN as the GaggiMate (TrueNAS SCALE, Raspberry Pi, or any Linux box)
- **Node.js 18+** (only needed if running outside Docker)

---

## Step 1: Find the GaggiMate IP Address

The GaggiMate ESP32 advertises itself as `gaggimate.local` via mDNS, but Docker containers can't resolve mDNS hostnames. You need the actual IP address.

**Option A: Check your router's DHCP client list**
1. Log into your router admin page
2. Find the device named `gaggimate` or with manufacturer `Espressif`
3. Note the IP (e.g., `192.168.1.100`)

**Option B: Network scanner**
```bash
# macOS/Linux
nmap -sn 192.168.1.0/24 | grep -i espressif
# Or try mDNS
ping gaggimate.local
```

**Recommended:** Set a DHCP reservation in your router so the IP never changes.

**Verify:** Open `http://<gaggimate-ip>` in a browser — you should see the GaggiMate web UI.

---

## Step 2: Create Notion Databases

Create three databases in your Notion workspace. The names are flexible, but the property names must match exactly.

### Beans Database

| Property | Type | Notes |
|---|---|---|
| Bean Name | Title | Free-form name, e.g. "Ethiopia Yirgacheffe Natural" |
| Roaster | Select | Builds reusable list over time |
| Origin | Select | Country/region |
| Process | Select | Natural, Washed, Honey, Anaerobic, Wet-hulled |
| Roast Level | Select | Light, Medium-Light, Medium, Medium-Dark, Dark |
| Roast Date | Date | From the bag (when roasted) |
| Open Date | Date | When you opened the bag |
| Days Since Roast | Formula | `dateBetween(now(), prop("Roast Date"), "days")` |
| Bag Size | Number | Grams |
| Price | Number | Dollars |
| Tasting Notes | Text | Roaster notes or your impressions |
| Buy Again | Checkbox | Quick favorites/re-order filter |
| Purchase URL | URL | Re-order link |
| Brews | Relation → Brews | Two-way relation |
| Notes | Text | Anything else |

### Brews Database

| Property | Type | Notes |
|---|---|---|
| Brew | Title | Auto-generated, e.g. "#047 - Feb 14 AM" |
| Activity ID | Text | GaggiMate shot ID (dedup key) |
| Date | Date (with time) | When the shot was pulled |
| Beans | Relation → Beans | Two-way relation |
| Profile | Relation → Profiles | Two-way relation |
| Grind Setting | Number | User entry |
| Dose In | Number | Grams |
| Yield Out | Number | Grams (auto/manual) |
| Ratio | Formula | `prop("Yield Out") / prop("Dose In")` |
| Brew Time | Number | Seconds (auto) |
| Brew Temp | Number | Celsius (auto) |
| Pre-infusion Time | Number | Seconds (auto) |
| Peak Pressure | Number | Bar (auto) |
| Total Volume | Number | mL (auto) |
| Bean Age | Formula | Days between related Bean roast date and Brew date |
| Taste Notes | Text | Free-form tasting notes |
| Channeling | Checkbox | Visual channeling observed |
| Source | Select | `Auto` or `Manual` |
| Notes | Text | Anything else |

### Profiles Database

| Property | Type | Notes |
|---|---|---|
| Profile Name | Title | e.g. "Classic 9-bar Flat" |
| Description | Text | What the profile does |
| Profile Type | Select | Flat, Declining, Blooming, Lever, Turbo, Custom |
| Best For | Multi-select | Light Roast, Medium Roast, Dark Roast, etc. |
| Source | Select | Stock, Community, AI-Generated, Custom |
| Active on Machine | Checkbox | Tracking what's loaded |
| Profile Image | File | Screenshot/export of curve |
| Profile JSON | Text | Raw JSON the machine reads |
| Push Status | Select | `Draft`, `Queued`, `Pushed`, `Failed` |
| Last Pushed | Date (with time) | Auto-set by bridge |
| Brews | Relation → Brews | Two-way relation |
| Notes | Text | Anything else |

Relations map:
- Beans `<->` Brews (via `Brews` on Beans and `Beans` on Brews)
- Profiles `<->` Brews (via `Brews` on Profiles and `Profile` on Brews)

### What The Bridge Writes vs What Notion/User Owns

The bridge does not manage every field. Keep formulas/relations in Notion, and let the bridge populate only the machine-derived fields.

**Beans DB**
- Bridge writes: none
- Notion/user-managed: all properties (including formulas and relations)

**Brews DB**
- Bridge writes on create:
  - `Brew`
  - `Activity ID`
  - `Date`
  - `Brew Time`
  - `Brew Temp`
  - `Pre-infusion Time`
  - `Peak Pressure`
  - `Total Volume`
  - `Yield Out` (only when weight exists)
  - `Source` (`Auto`)
  - `Profile` relation (if a matching `Profile Name` is found in Profiles DB)
- Bridge backfills:
  - `Profile` relation for existing brews missing it (uses `Activity ID` + GaggiMate shot profile)
- Notion/user-managed:
  - `Beans` relation
  - `Grind Setting`
  - `Dose In`
  - `Ratio` (formula)
  - `Bean Age` (formula)
  - `Taste Notes`
  - `Channeling`
  - `Notes`

**Profiles DB**
- Bridge writes:
  - On profile reconcile from GaggiMate (non-destructive):
    - `Profile Name`
    - `Description`
    - `Profile Type`
    - `Source`
    - `Active on Machine`
    - `Profile JSON`
    - `Push Status` (`Pushed`)
    - `Last Pushed` (import timestamp)
  - Marks profiles not currently on machine as `Active on Machine = false` (keeps history in Notion)
  - `Push Status` (to `Pushed` or `Failed` after push attempts)
  - `Last Pushed` (timestamp on success)
- Bridge reads:
  - `Profile Name`
  - `Profile JSON`
  - `Push Status` (`Queued` trigger)
- Notion/user-managed:
  - `Description`
  - `Profile Type`
  - `Best For`
  - `Source`
  - `Active on Machine`
  - `Profile Image`
  - `Brews` relation
  - `Notes`

**After creating databases:** Share each one with your Notion integration (Step 3).

---

## Step 3: Create Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"New integration"**
3. Name: `GaggiMate Bridge`
4. Capabilities: **Read content**, **Update content**, **Insert content** — all enabled
5. Copy the **Internal Integration Token** (starts with `ntn_`)
6. **Share each database** with the integration:
   - Open each database in Notion
   - Click **Share** → Invite → search for your integration name → **Invite**

**Get database IDs:** Open each database in Notion as a full page. The URL looks like:
```
https://www.notion.so/yourworkspace/abc123def456...?v=...
                                    ^^^^^^^^^^^^^^^^
                                    This is the database ID
```

**Verify:**
```bash
curl -H "Authorization: Bearer ntn_YOUR_TOKEN" \
     -H "Notion-Version: 2022-06-28" \
     https://api.notion.com/v1/users/me
```

Should return your user info without errors.

---

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# GaggiMate IP from Step 1
GAGGIMATE_HOST=192.168.1.100
GAGGIMATE_PROTOCOL=ws

# Notion token from Step 3
NOTION_API_KEY=ntn_XXXXXXXXXXXX

# Database IDs from Step 3
NOTION_BEANS_DB_ID=abc123...
NOTION_BREWS_DB_ID=def456...
NOTION_PROFILES_DB_ID=ghi789...

# Leave empty if not using webhooks yet
WEBHOOK_SECRET=

# Polling fallback (recommended: true until webhooks are set up)
POLLING_FALLBACK=true
PROFILE_IMPORT_ENABLED=true
PROFILE_IMPORT_INTERVAL_MS=60000

# Defaults are fine for most setups
SYNC_INTERVAL_MS=30000
HTTP_PORT=3000
```

---

## Step 5: Deploy

### Option A: Docker Compose (recommended)

```bash
# Build and start
docker compose up --build -d

# Check logs
docker compose logs -f

# Verify health
curl http://localhost:3000/health
```

### Option B: TrueNAS SCALE "Install via YAML"

TrueNAS can't build images from source — it pulls pre-built images from a registry. Every push to `main` automatically builds and publishes the image to GitHub Container Registry.

1. Go to **Apps** → **Discover** → three-dot menu → **Install via YAML**
2. Paste the contents of `docker-compose.truenas.yml` (not `docker-compose.yml`)
3. Set the environment variables (GAGGIMATE_HOST, NOTION_API_KEY, database IDs) in the TrueNAS UI
4. The data volume is created automatically as a Docker named volume

### Option C: Run directly (development)

```bash
npm install
npm run dev
```

---

## Step 6: Verify It Works

### 1. Health check
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "gaggimate": { "host": "192.168.1.100", "reachable": true },
  "notion": { "connected": true },
  "lastShotSync": null,
  "lastShotId": null,
  "totalShotsSynced": 0,
  "uptime": 5
}
```

Both `reachable` and `connected` should be `true`. If not:
- `reachable: false` → Check GaggiMate IP, make sure Docker can reach it (try `docker exec <container> curl http://192.168.1.100`)
- `connected: false` → Check `NOTION_API_KEY` in `.env`

### 2. Pull a shot
Pull an espresso shot on your machine. Within 30 seconds, a new entry should appear in your Notion Brews database with the title format `#001 - Feb 14 AM`.

### 3. Test profile push
1. In your Notion Profiles database, create a new entry
2. Set the **Profile JSON** to:
   ```json
   {"temperature":93,"phases":[{"name":"Preinfusion","phase":"preinfusion","duration":10,"pump":{"target":"pressure","pressure":3}},{"name":"Extraction","phase":"brew","duration":30,"pump":{"target":"pressure","pressure":9}}]}
   ```
3. Set **Push Status** to `Queued`
4. Within 3 seconds (polling) the status should change to `Pushed`
5. Check the GaggiMate — an "AI Profile" should appear

### 4. Test profile import (GaggiMate → Notion)
1. Create a new profile on the GaggiMate UI
2. Pull a shot with that profile (immediate backfill), or wait up to 60 seconds (default import interval)
3. Confirm a new page appears in the Notion Profiles DB
4. Confirm imported profile starts with `Push Status = Pushed`
5. Confirm the brew's `Profile` relation links to that profile
6. Confirm profiles removed from machine are marked `Active on Machine = false` (not deleted)

---

## Step 7: Set Up Webhooks (Optional)

For real-time profile push (< 1 second instead of 3 seconds polling), set up Notion webhooks via Tailscale Funnel.

### Enable Tailscale Funnel

```bash
# On your TrueNAS (or Docker host)
tailscale funnel 3000
```

This gives you a public URL like `https://your-machine.tail12345.ts.net`.

### Create Notion Webhook

1. In [notion.so/my-integrations](https://www.notion.so/my-integrations), find your integration
2. Go to **Webhooks** → Create new webhook
3. Endpoint URL: `https://your-machine.tail12345.ts.net/webhook/notion`
4. Subscribe to page property changes on the Profiles database
5. Optional: copy the webhook secret and add it to your `.env` to enforce request signature validation:
   ```
   WEBHOOK_SECRET=your_webhook_secret_here
   ```
6. Restart the bridge service

**Verify:** Change a profile's Push Status to "Queued" — it should push within ~1 second.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `reachable: false` | GaggiMate not on network or wrong IP | Check IP, ensure DHCP reservation, try pinging from Docker host |
| `connected: false` | Bad Notion token | Re-copy from my-integrations, ensure no trailing whitespace |
| Shots not syncing | Database not shared with integration | Open each DB → Share → invite integration |
| Profile push "Failed" | Invalid Profile JSON | Check JSON format (see template above), temperature must be 60-100 |
| Docker can't resolve hostname | mDNS doesn't work in Docker | Use IP address, not `gaggimate.local` |

---

## Profile JSON Format

The GaggiMate expects profiles in this exact structure:

For full MCP-side validation rules (required fields, enums, ranges, and queued-only push behavior), see `mcp-json-validation.md`.

```json
{
  "label": "AI Profile",
  "type": "pro",
  "temperature": 93,
  "phases": [
    {
      "name": "Preinfusion",
      "phase": "preinfusion",
      "duration": 10,
      "pump": {
        "target": "pressure",
        "pressure": 3
      },
      "transition": {
        "type": "linear",
        "duration": 2
      },
      "targets": [
        {
          "type": "pressure",
          "operator": "gte",
          "value": 4
        }
      ]
    },
    {
      "name": "Extraction",
      "phase": "brew",
      "duration": 30,
      "pump": {
        "target": "pressure",
        "pressure": 9
      }
    }
  ]
}
```

**Key constraints:**
- `temperature`: 60-100 (Celsius)
- `phases`: at least one phase required
- Each phase needs: `name`, `phase` ("preinfusion" or "brew"), `duration` (seconds)
- `pump.target`: "pressure" (bar) or "flow" (ml/s)
- `targets`: optional stop conditions (phase ends when any condition is met)
