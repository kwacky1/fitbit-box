require("dotenv").config();
const { Octokit } = require("@octokit/rest");
const fetch = require("node-fetch");
const fs = require("fs");

const {
  GIST_ID: gistId,
  GH_TOKEN: githubToken,
  GOOGLE_CLIENT_ID: clientId,
  GOOGLE_CLIENT_SECRET: clientSecret,
  GOOGLE_REFRESH_TOKEN: refreshToken,
  UNITS: units,
} = process.env;

const API_BASE = "https://health.googleapis.com/v4";
const AUTH_CACHE_FILE = "google-auth.json";

// One-off YTD cycling baseline (km) for Jan–Feb 2026 outdoor rides that were
// tracked on Strava but never synced to Google Health. Equals
// Strava(Jan+Feb) − GoogleHealth(Jan+Feb) = 410.04 − 40.85. Only applied to the
// cycling YTD column. Reset to 0 at the start of 2027.
const CYCLING_YTD_BASELINE_KM = 369.19;

const octokit = new Octokit({ auth: `token ${githubToken}` });

async function main() {
  const token = await getGoogleToken();
  const now = new Date();
  const ytdStart = `${now.getFullYear()}-01-01T00:00:00Z`;
  const todayEnd = new Date(now.getTime() + 86400000).toISOString().split("T")[0] + "T00:00:00Z";

  const [stepPoints, sleepPoints, exercisePoints] = await Promise.all([
    getDataPoints(token, "steps", ytdStart, todayEnd),
    getDataPoints(token, "sleep", ytdStart, todayEnd),
    getDataPoints(token, "exercise", ytdStart, todayEnd),
  ]);

  // Steps: sum the count field per interval
  const stepsWithTime = stepPoints.map((p) => ({
    startTime: p.steps.interval.startTime,
    value: parseInt(p.steps.count, 10) || 0,
  }));

  // Sleep: extract minutesAsleep from summary, skip naps
  const sleepSessions = sleepPoints.map((p) => ({
    startTime: p.sleep.interval.startTime,
    minutesAsleep: parseInt(p.sleep.summary?.minutesAsleep, 10) || 0,
    isMainSleep: true, // Google Health doesn't mark naps the same way; all sessions treated as main
  }));

  // Exercise: map types and extract distance/duration
  const exercises = normaliseExercises(exercisePoints);

  const sumByPeriod = (points, days) => {
    const cutoff = new Date(now.getTime() - days * 86400000);
    return points
      .filter((p) => new Date(p.startTime) >= cutoff)
      .reduce((sum, p) => sum + p.value, 0);
  };
  const sumAll = (points) => points.reduce((sum, p) => sum + p.value, 0);

  const sleepAvg = (days) => {
    const cutoff = new Date(now.getTime() - days * 86400000);
    const recent = sleepSessions.filter((s) => new Date(s.startTime) >= cutoff);
    if (recent.length === 0) return 0;
    return Math.round(recent.reduce((sum, s) => sum + s.minutesAsleep, 0) / recent.length);
  };

  const groupExercises = (days) => {
    const cutoff = days ? new Date(now.getTime() - days * 86400000) : new Date("2000-01-01");
    const groups = {};
    for (const ex of exercises) {
      if (new Date(ex.startTime) < cutoff) continue;
      const name = ex.activityType;
      if (!groups[name]) groups[name] = { count: 0, distance: 0 };
      groups[name].count++;
      groups[name].distance += ex.distanceKm;
    }
    return groups;
  };

  // Derive active minutes from exercise activeDuration
  const activeMinWithTime = exercises.map((ex) => ({
    startTime: ex.startTime,
    value: ex.activeMinutes,
  }));

  const stats = {
    steps: [sumByPeriod(stepsWithTime, 7), sumByPeriod(stepsWithTime, 30), sumAll(stepsWithTime)],
    activeMin: [sumByPeriod(activeMinWithTime, 7), sumByPeriod(activeMinWithTime, 30), sumAll(activeMinWithTime)],
    sleepAvg: [sleepAvg(7), sleepAvg(30), sleepAvg(365)],
    groups7d: groupExercises(7),
    groups30d: groupExercises(30),
    groupsYtd: groupExercises(null),
  };

  await updateGist(stats);
  console.log("Gist updated successfully.");
}

// --- Google OAuth ---

async function getGoogleToken() {
  let cache = { refreshToken };

  try {
    const data = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, "utf8"));
    if (data.refreshToken) cache.refreshToken = data.refreshToken;
  } catch {
    // No cache yet, use env var
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cache.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cache.accessToken = data.access_token;
  if (data.refresh_token) {
    cache.refreshToken = data.refresh_token;
  }

  fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(cache));
  console.log("Token refreshed successfully.");

  return cache.accessToken;
}

// --- Google Health API ---

// Filter field varies by data type
const FILTER_FIELDS = {
  steps: "steps.interval.start_time",
  sleep: "sleep.interval.end_time",
  exercise: null, // no filter support — paginate and filter client-side
};

async function getDataPoints(token, dataType, startTime, endTime) {
  const filterField = FILTER_FIELDS[dataType];
  let allPoints = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({ pageSize: "10000" });
    if (filterField) {
      params.set("filter", `${filterField} >= "${startTime}" AND ${filterField} < "${endTime}"`);
    }
    if (pageToken) params.set("pageToken", pageToken);

    const url = `${API_BASE}/users/me/dataTypes/${dataType}/dataPoints?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Health API error (${res.status}) ${dataType}: ${err}`);
    }

    const data = await res.json();
    const points = data.dataPoints || [];
    allPoints = allPoints.concat(points);
    pageToken = data.nextPageToken || null;

    // For unfiltered types, stop once we've passed the date range
    // (data comes in reverse chronological order)
    if (!filterField && points.length > 0) {
      const lastPoint = points[points.length - 1];
      const lastTime = extractStartTime(lastPoint, dataType);
      if (lastTime && lastTime < startTime) break;
    }
  } while (pageToken);

  // Client-side date filtering for types that don't support server-side filtering
  if (!filterField) {
    allPoints = allPoints.filter((p) => {
      const t = extractStartTime(p, dataType);
      return t && t >= startTime && t < endTime;
    });
  }

  return allPoints;
}

function extractStartTime(point, dataType) {
  if (dataType === "exercise") return point.exercise?.interval?.startTime;
  if (dataType === "sleep") return point.sleep?.interval?.startTime;
  if (dataType === "steps") return point.steps?.interval?.startTime;
  return null;
}

// --- Data Normalisation ---

function normaliseExercises(points) {
  const TYPE_MAP = {
    WALKING: "Walk",
    BIKING: "Bike",
    CYCLING: "Bike",
    STRENGTH_TRAINING: "Strength training",
    WEIGHTLIFTING: "Strength training",
    WORKOUT: "Strength training",
  };

  return points.map((p) => {
    const ex = p.exercise || {};
    const rawType = ex.exerciseType || "OTHER";
    const metrics = ex.metricsSummary || {};
    // distanceMillimeters is in mm
    const distKm = (metrics.distanceMillimeters || 0) / 1_000_000;
    // activeDuration is like "1433s" or "1433.552s"
    const durationSec = parseFloat(ex.activeDuration) || 0;
    const activeMin = Math.round(durationSec / 60);

    return {
      startTime: ex.interval?.startTime,
      activityType: TYPE_MAP[rawType] || rawType,
      distanceKm: distKm,
      activeMinutes: activeMin,
    };
  });
}

// --- Gist Formatting ---

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
    if (!merged[cfg.label]) merged[cfg.label] = { emoji: cfg.emoji, d7: 0, d30: 0, ytd: 0, dist7: 0, dist30: 0, distYtd: 0 };
    merged[cfg.label].d7 += stats.groups7d[name]?.count || 0;
    merged[cfg.label].d30 += stats.groups30d[name]?.count || 0;
    merged[cfg.label].ytd += stats.groupsYtd[name]?.count || 0;
    merged[cfg.label].dist7 += stats.groups7d[name]?.distance || 0;
    merged[cfg.label].dist30 += stats.groups30d[name]?.distance || 0;
    merged[cfg.label].distYtd += stats.groupsYtd[name]?.distance || 0;
  }

  for (const [label, data] of Object.entries(merged)) {
    if (label === "Cycling") {
      lines.push(
        formatLine(
          `${data.emoji} ${label}`,
          formatDistance(data.dist7),
          formatDistance(data.dist30),
          formatDistance(data.distYtd + CYCLING_YTD_BASELINE_KM)
        )
      );
    } else {
      lines.push(
        formatLine(
          `${data.emoji} ${label}`,
          String(data.d7),
          String(data.d30),
          String(data.ytd)
        )
      );
    }
  }

  const header = ` ${visPadEnd("", 14)} ${visPadStart("7 days", 9)} ${visPadStart("30 days", 9)} ${visPadStart("YTD", 9)}`;
  const content = [header, ...lines].join("\n");

  try {
    const filename = Object.keys(gist.data.files)[0];
    await octokit.gists.update({
      gist_id: gistId,
      files: {
        [filename]: {
          filename: "🏃 Fitness Stats",
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
function visualWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0xfe0f || code === 0xfe0e || code === 0x200d) continue;
    if (code >= 0xd800 && code <= 0xdbff) { width += 2; i++; continue; }
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
