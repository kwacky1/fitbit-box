require("dotenv").config();
const { Octokit } = require("@octokit/rest");
const fetch = require("node-fetch");
const fs = require("fs");

const {
  GIST_ID: gistId,
  GH_TOKEN: githubToken,
  FITBIT_CLIENT_ID: clientId,
  FITBIT_CLIENT_SECRET: clientSecret,
  FITBIT_REFRESH_TOKEN: refreshToken,
  UNITS: units,
} = process.env;

const API_BASE = "https://api.fitbit.com";
const AUTH_CACHE_FILE = "fitbit-auth.json";

const octokit = new Octokit({ auth: `token ${githubToken}` });

async function main() {
  const token = await getFitbitToken();
  const today = new Date();
  const ytdStart = `${today.getFullYear()}-01-01`;
  const todayStr = today.toISOString().split("T")[0];

  // Fetch time series for YTD (covers 7d and 30d too)
  const [steps, distance, fairlyActive, veryActive, sleep, exercises] =
    await Promise.all([
      fitbitGet(token, `/1/user/-/activities/steps/date/${ytdStart}/${todayStr}.json`),
      fitbitGet(token, `/1/user/-/activities/distance/date/${ytdStart}/${todayStr}.json`),
      fitbitGet(token, `/1/user/-/activities/minutesFairlyActive/date/${ytdStart}/${todayStr}.json`),
      fitbitGet(token, `/1/user/-/activities/minutesVeryActive/date/${ytdStart}/${todayStr}.json`),
      getSleepLogs(token, ytdStart, todayStr),
      getExerciseLogs(token, ytdStart),
    ]);

  const sumLast = (series, days) =>
    series.slice(-days).reduce((s, e) => s + Number(e.value), 0);

  const stepsSeries = steps["activities-steps"] || [];
  const distSeries = distance["activities-distance"] || [];
  const fairlySeries = fairlyActive["activities-minutesFairlyActive"] || [];
  const verySeries = veryActive["activities-minutesVeryActive"] || [];

  const activeMinSeries = fairlySeries.map((e, i) => ({
    value: Number(e.value) + Number(verySeries[i]?.value || 0),
  }));

  const sleepAvg = (logs, days) => {
    const cutoff = dateStr(days);
    const recent = logs.filter((s) => s.dateOfSleep >= cutoff && s.isMainSleep);
    if (recent.length === 0) return 0;
    return Math.round(
      recent.reduce((sum, s) => sum + (s.minutesAsleep || 0), 0) / recent.length
    );
  };

  const countExercises = (activities, days) => {
    const cutoff = dateStr(days);
    return activities.filter((a) => (a.startTime || "").substring(0, 10) >= cutoff);
  };

  const allExercises = exercises.activities || [];

  // Extract date from startTime (ISO datetime)
  const activityDate = (a) => (a.startTime || "").substring(0, 10);

  // Group activities by name, bucketed by period
  const groupActivities = (activities, days) => {
    const cutoff = days ? dateStr(days) : "0000-00-00";
    const groups = {};
    for (const a of activities) {
      if (activityDate(a) < cutoff) continue;
      const name = a.activityName || "Other";
      if (!groups[name]) groups[name] = { count: 0, distance: 0 };
      groups[name].count++;
      groups[name].distance += a.distance || 0;
    }
    return groups;
  };

  const groups7d = groupActivities(allExercises, 7);
  const groups30d = groupActivities(allExercises, 30);
  const groupsYtd = groupActivities(allExercises, null);

  // Get all unique activity names, sorted by YTD count descending
  const activityNames = [...new Set(allExercises.map((a) => a.activityName || "Other"))]
    .sort((a, b) => (groupsYtd[b]?.count || 0) - (groupsYtd[a]?.count || 0));

  const stats = {
    steps: [sumLast(stepsSeries, 7), sumLast(stepsSeries, 30), sumLast(stepsSeries, stepsSeries.length)],
    distance: [sumLast(distSeries, 7), sumLast(distSeries, 30), sumLast(distSeries, distSeries.length)],
    activeMin: [sumLast(activeMinSeries, 7), sumLast(activeMinSeries, 30), sumLast(activeMinSeries, activeMinSeries.length)],
    sleepAvg: [sleepAvg(sleep, 7), sleepAvg(sleep, 30), sleepAvg(sleep, 365)],
    activityNames,
    groups7d,
    groups30d,
    groupsYtd,
  };

  await updateGist(stats);
  console.log("Gist updated successfully.");
}

// --- Fitbit Auth ---

async function getFitbitToken() {
  let cache = { refreshToken };

  try {
    const data = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, "utf8"));
    if (data.refreshToken) cache.refreshToken = data.refreshToken;
  } catch {
    // No cache yet, use env var
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );
  const res = await fetch(`${API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cache.refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fitbit token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cache.accessToken = data.access_token;
  cache.refreshToken = data.refresh_token;

  fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(cache));
  console.log("Token refreshed successfully.");

  return cache.accessToken;
}

// --- Fitbit API ---

async function fitbitGet(token, path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fitbit API error (${res.status}) ${path}: ${err}`);
  }
  return res.json();
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// getActivitySummaries removed — using time series endpoints instead

async function getSleepLogs(token, startDate, endDate) {
  // Fitbit Sleep API limits date range to 100 days per request
  const MAX_DAYS = 100;
  let allSleep = [];
  let cursor = new Date(startDate);
  const end = new Date(endDate);

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + MAX_DAYS - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const from = cursor.toISOString().split("T")[0];
    const to = chunkEnd.toISOString().split("T")[0];
    const data = await fitbitGet(
      token,
      `/1.2/user/-/sleep/date/${from}/${to}.json`
    );
    allSleep = allSleep.concat(data.sleep || []);

    cursor.setDate(chunkEnd.getDate() + 1);
  }

  return allSleep;
}

async function getExerciseLogs(token, afterDate) {
  let allActivities = [];
  let hasMore = true;
  let offset = 0;

  while (hasMore) {
    const data = await fitbitGet(
      token,
      `/1/user/-/activities/list.json?afterDate=${afterDate}&sort=asc&limit=100&offset=${offset}`
    );
    const activities = data.activities || [];
    allActivities = allActivities.concat(activities);
    hasMore = data.pagination?.next != null && activities.length === 100;
    offset += 100;
  }

  return { activities: allActivities };
}

// --- Gist Formatting ---

function formatNumber(n) {
  return n.toLocaleString("en-AU");
}

function formatDistance(km) {
  if (units === "miles") {
    return `${(km * 0.621371).toFixed(1)}mi`;
  }
  return `${km.toFixed(1)}km`;
}

function formatMinutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

async function updateGist(stats) {
  let gist;
  try {
    gist = await octokit.gists.get({ gist_id: gistId });
  } catch (error) {
    console.error(`Unable to get gist\n${error}`);
    throw error;
  }

  const ACTIVITY_MAP = {
    Walk: { emoji: "🚶", label: "Walks" },
    Bike: { emoji: "🚴", label: "Cycling" },
    "Strength training": { emoji: "🏋️", label: "Workouts" },
  };

  const lines = [
    formatLine(
      "😴 Sleep Avg",
      formatMinutesToTime(stats.sleepAvg[0]),
      formatMinutesToTime(stats.sleepAvg[1]),
      formatMinutesToTime(stats.sleepAvg[2])
    ),
  ];

  // Merge activity groups by display label
  const merged = {};
  for (const [name, cfg] of Object.entries(ACTIVITY_MAP)) {
    if (!merged[cfg.label]) merged[cfg.label] = { emoji: cfg.emoji, d7: 0, d30: 0, ytd: 0 };
    merged[cfg.label].d7 += stats.groups7d[name]?.count || 0;
    merged[cfg.label].d30 += stats.groups30d[name]?.count || 0;
    merged[cfg.label].ytd += stats.groupsYtd[name]?.count || 0;
  }

  for (const [label, data] of Object.entries(merged)) {
    lines.push(
      formatLine(
        `${data.emoji} ${label}`,
        String(data.d7),
        String(data.d30),
        String(data.ytd)
      )
    );
  }

  const header = ` ${visPadEnd("", 14)} ${visPadStart("7 days", 9)} ${visPadStart("30 days", 9)} ${visPadStart("YTD", 9)}`;
  const content = [header, ...lines].join("\n");

  try {
    const filename = Object.keys(gist.data.files)[0];
    await octokit.gists.update({
      gist_id: gistId,
      files: {
        [filename]: {
          filename: "🏃 Fitbit Stats",
          content,
        },
      },
    });
  } catch (error) {
    console.error(`Unable to update gist\n${error}`);
    throw error;
  }
}

// Visual width of a string in a monospace terminal/gist
// Emojis (surrogate pairs) = 2 cells, variation selectors/ZWJ = 0 cells
function visualWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0xfe0f || code === 0xfe0e || code === 0x200d) continue; // variation selectors, ZWJ
    if (code >= 0xd800 && code <= 0xdbff) { width += 2; i++; continue; } // surrogate pair = emoji
    width++;
  }
  return width;
}

function visPadEnd(str, len) {
  return str + " ".repeat(Math.max(0, len - visualWidth(str)));
}

function visPadStart(str, len) {
  return " ".repeat(Math.max(0, len - visualWidth(str))) + str;
}

function formatLine(label, val7d, val30d, valYtd) {
  return `${visPadEnd(label, 14)} ${visPadStart(val7d, 9)} ${visPadStart(val30d, 9)} ${visPadStart(valYtd, 9)}`;
}

(async () => {
  await main();
})();
