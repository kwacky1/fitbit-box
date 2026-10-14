require("dotenv").config();
const fetch = require("node-fetch");

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: refreshToken } = process.env;

async function main() {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  console.log("Got token:", !!token);

  let pageToken = null;
  let page = 0;
  const pageSize = 1;
  let totalPoints = 0;
  do {
    page++;
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) {
      console.log(`page=${page} status=${res.status} bodyLen=${text.length}`);
      console.log("error body:", text.slice(0, 500));
      break;
    }
    const data = JSON.parse(text);
    const points = data.dataPoints || [];
    totalPoints += points.length;
    const p0 = points[0];
    console.log(
      `page=${page} total=${totalPoints} startTime=${p0?.exercise?.interval?.startTime} endTime=${p0?.exercise?.interval?.endTime} type=${p0?.exercise?.exerciseType} metrics=${JSON.stringify(p0?.exercise?.metricsSummary)}`
    );
    pageToken = data.nextPageToken || null;
    if (page > 160) {
      console.log("Stopping after 160 pages for safety");
      break;
    }
  } while (pageToken);
  console.log("DONE. total points:", totalPoints);
}

main().catch((e) => console.error("FAILED", e));
