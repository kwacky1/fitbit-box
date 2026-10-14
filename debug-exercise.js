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

  for (const pageSize of [1, 5, 20]) {
    const url = `https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?pageSize=${pageSize}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    console.log(`pageSize=${pageSize} status=${res.status} bodyLen=${text.length}`);
    if (res.ok) {
      const data = JSON.parse(text);
      console.log(
        "points:",
        (data.dataPoints || []).map((p) => ({
          startTime: p.exercise?.interval?.startTime,
          endTime: p.exercise?.interval?.endTime,
          type: p.exercise?.exerciseType,
        }))
      );
    } else {
      console.log("error body:", text.slice(0, 500));
    }
  }
}

main().catch((e) => console.error("FAILED", e));
