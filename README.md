# fitbit-box 🏃

Display your [Google Health](https://health.google.com/) (formerly Fitbit) activity stats in a pinned GitHub gist.

Shows 7-day, 30-day, and YTD summaries for sleep, walks, cycling, and workouts.

```
                 7 days   30 days       YTD
😴 Sleep Avg      7h56m     6h21m     7h13m
🚶 Walks             26        57       217
🚴 Cycling       50.9km   127.3km  1240.5km
🏋️ Workouts           4        15        42
```

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project
2. Enable the **Google Health API** (`health.googleapis.com`)
3. Configure the **OAuth consent screen** (External, add yourself as a test user)
4. Create **OAuth 2.0 credentials** (Web application type)
5. Add `http://localhost` as an authorised redirect URI
6. Note your **Client ID** and **Client Secret**

### 2. Get Your Google Refresh Token

```bash
cp sample.env .env
# Edit .env with your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET

npm install
node setup.js
# Follow the prompts to authorise and get your refresh token
```

### 3. Create a GitHub Gist

1. Create a new [public gist](https://gist.github.com/) with any content
2. Note the gist ID from the URL (the long hex string)

### 4. Create a GitHub Personal Access Token

1. Go to [GitHub Settings > Tokens](https://github.com/settings/tokens)
2. Create a token with the `gist` scope

### 5. Configure GitHub Actions Secrets

In your fork/copy of this repo, go to **Settings > Secrets and variables > Actions** and add:

| Secret | Description |
|--------|-------------|
| `GOOGLE_CLIENT_ID` | Your Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | The refresh token from step 2 |
| `GIST_ID` | The ID of your GitHub gist |
| `GH_TOKEN` | GitHub personal access token with `gist` scope |

The workflow runs every 6 hours automatically, or you can trigger it manually from the Actions tab.

> **Note:** If your OAuth consent screen is in "testing" mode, refresh tokens expire after 7 days. Publish the app to "production" in Cloud Console for persistent tokens (no verification needed for personal use with <100 users).

## Local Development

```bash
cp sample.env .env
# Fill in all values
npm install
node index.js
```

## Acknowledgements

Inspired by [strava-box](https://github.com/JohnPhamous/strava-box) and the [dev-box](https://github.com/matchai/awesome-pinned-gists) collection.
