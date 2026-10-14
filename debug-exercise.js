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
  const pageSize = 20;
  do {
    page++;
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    console.log(`page=${page} status=${res.status} bodyLen=${text.length}`);
    if (!res.ok) {
      console.log("error body:", text.slice(0, 1000));
      break;
    }
    const data = JSON.parse(text);
    const points = data.dataPoints || [];
    if (points.length > 0) {
      const first = points[0];
      const last = points[points.length - 1];
      console.log(
        "first:",
        first.exercise?.interval?.startTime,
        first.exercise?.exerciseType,
        "last:",
        last.exercise?.interval?.startTime,
        last.exercise?.exerciseType
      );
    }
    pageToken = data.nextPageToken || null;
    console.log("nextPageToken present:", !!pageToken);
    if (page > 60) {
      console.log("Stopping after 60 pages for safety");
      break;
    }
  } while (pageToken);
}

main().catch((e) => console.error("FAILED", e));
