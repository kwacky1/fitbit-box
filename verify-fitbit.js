// Throwaway diagnostic: read-only Fitbit YTD cycling check.
// Refreshes the Fitbit token, rotates the FITBIT_REFRESH_TOKEN secret back
// (Fitbit invalidates the old one on use), then prints cycling distances.
// Never logs secret values.

const fetch = require("node-fetch");
const { execSync } = require("child_process");

const {
  FITBIT_CLIENT_ID: clientId,
  FITBIT_CLIENT_SECRET: clientSecret,
  FITBIT_REFRESH_TOKEN: refreshToken,
} = process.env;

const API_BASE = "https://api.fitbit.com";

async function getFitbitToken() {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Fitbit token refresh failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();

  // Persist the rotated refresh token back to the secret so this stays runnable.
  const newRefresh = data.refresh_token;
  if (newRefresh) {
    console.log(`::add-mask::${newRefresh}`);
    try {
      execSync(`gh secret set FITBIT_REFRESH_TOKEN --body "${newRefresh}"`, { stdio: "inherit" });
      console.log("Rotated FITBIT_REFRESH_TOKEN secret updated.");
    } catch (e) {
      console.log("WARNING: could not update FITBIT_REFRESH_TOKEN secret (token now rotated).");
    }
  }
  return data.access_token;
}

async function fitbitGet(token, path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Fitbit API error (${res.status}) ${path}: ${await res.text()}`);
  return res.json();
}

async function getExerciseLogs(token, afterDate) {
  let all = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const data = await fitbitGet(
      token,
      `/1/user/-/activities/list.json?afterDate=${afterDate}&sort=asc&limit=100&offset=${offset}`
    );
    const activities = data.activities || [];
    all = all.concat(activities);
    hasMore = data.pagination?.next != null && activities.length === 100;
    offset += 100;
  }
  return all;
}

(async () => {
  const token = await getFitbitToken();
  const now = new Date();
  const ytdStart = `${now.getFullYear()}-01-01`;

  const activities = await getExerciseLogs(token, ytdStart);
  console.log(`\nTotal activities fetched (YTD): ${activities.length}`);

  // Breakdown by activityName so we can see every label Fitbit uses.
  const byName = {};
  for (const a of activities) {
    const name = a.activityName || "Other";
    if (!byName[name]) byName[name] = { count: 0, distance: 0 };
    byName[name].count++;
    byName[name].distance += a.distance || 0;
  }
  console.log(`\n--- All activity types (YTD) ---`);
  for (const [name, g] of Object.entries(byName).sort((x, y) => y[1].distance - x[1].distance)) {
    console.log(`${name.padEnd(22)} ${String(g.count).padStart(4)} acts   ${g.distance.toFixed(1)}km`);
  }

  // Cycling subset: any name that looks bike-ish.
  const isCycling = (n) => /bike|cycl|spin|ride/i.test(n);
  const bikes = activities.filter((a) => isCycling(a.activityName || ""));

  const dateOf = (a) => (a.startTime || "").substring(0, 10);
  const cutoff = (days) => {
    const d = new Date(now.getTime() - days * 86400000);
    return d.toISOString().split("T")[0];
  };
  const sumDist = (arr) => arr.reduce((s, a) => s + (a.distance || 0), 0);

  const d7 = bikes.filter((a) => dateOf(a) >= cutoff(7));
  const d30 = bikes.filter((a) => dateOf(a) >= cutoff(30));

  console.log(`\n=== FITBIT CYCLING ===`);
  console.log(`7-day : ${sumDist(d7).toFixed(1)}km  (${d7.length} rides)`);
  console.log(`30-day: ${sumDist(d30).toFixed(1)}km  (${d30.length} rides)`);
  console.log(`YTD   : ${sumDist(bikes).toFixed(1)}km  (${bikes.length} rides)`);

  console.log(`\n--- Each cycling ride (YTD) ---`);
  for (const a of bikes) {
    console.log(`${a.startTime}  ${(a.distance || 0).toFixed(2).padStart(7)}km  ${a.activityName}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
