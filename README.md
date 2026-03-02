# fitbit-box 🏃

Display your [Fitbit](https://www.fitbit.com/) activity stats in a pinned GitHub gist.

Shows 7-day and 30-day summaries for steps, distance, active minutes, sleep, and workouts.

```
                  7 days   30 days
🦶 Steps         52,340   214,500
📏 Distance       38.2km   156.1km
⚡ Active Min        210       845
😴 Sleep Avg      7h12m     6h58m
🏋️ Workouts           4        16
```

## Setup

### 1. Create a Fitbit App

1. Go to [dev.fitbit.com](https://dev.fitbit.com/apps/new) and register a new app
2. Set **OAuth 2.0 Application Type** to **Personal**
3. Set **Redirect URL** to `http://localhost`
4. Note your **Client ID** and **Client Secret**

### 2. Get Your Fitbit Refresh Token

```bash
cp sample.env .env
# Edit .env with your FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET

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
| `FITBIT_CLIENT_ID` | Your Fitbit app client ID |
| `FITBIT_CLIENT_SECRET` | Your Fitbit app client secret |
| `FITBIT_REFRESH_TOKEN` | The refresh token from step 2 |
| `GIST_ID` | The ID of your GitHub gist |
| `GH_TOKEN` | GitHub personal access token with `gist` scope |

The workflow runs every 6 hours automatically, or you can trigger it manually from the Actions tab.

## Local Development

```bash
cp sample.env .env
# Fill in all values
npm install
node index.js
```

## Acknowledgements

Inspired by [strava-box](https://github.com/JohnPhamous/strava-box) and the [dev-box](https://github.com/matchai/awesome-pinned-gists) collection.
