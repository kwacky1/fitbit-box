/**
 * One-time helper to exchange an authorization code for Fitbit tokens.
 *
 * Usage:
 *   1. Copy .env from sample.env, fill in FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET
 *   2. Open this URL in your browser (replace YOUR_CLIENT_ID):
 *      https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost&scope=activity+sleep&expires_in=31536000
 *   3. After authorizing, copy the 'code' parameter from the redirect URL
 *   4. Run: node setup.js YOUR_CODE_HERE
 *   5. The refresh token will be printed — add it to your .env / GitHub secrets
 */
require("dotenv").config();
const fetch = require("node-fetch");

const {
  FITBIT_CLIENT_ID: clientId,
  FITBIT_CLIENT_SECRET: clientSecret,
} = process.env;

const code = process.argv[2];
if (!code) {
  const authUrl = `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=http%3A%2F%2Flocalhost&scope=activity+sleep&expires_in=31536000`;
  console.log("No authorization code provided.\n");
  console.log("Step 1: Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\nStep 2: Authorise the app, then copy the 'code' from the redirect URL.");
  console.log("        (The page won't load — that's fine, just grab the code from the address bar)\n");
  console.log("Step 3: Run again with the code:");
  console.log("        node setup.js YOUR_CODE_HERE\n");
  process.exit(0);
}

(async () => {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Token exchange failed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("Success! Here are your tokens:\n");
  console.log(`FITBIT_REFRESH_TOKEN=${data.refresh_token}\n`);
  console.log("Add the refresh token above to your .env file and GitHub Actions secrets.");
  console.log(`\nAccess token (expires): ${data.access_token}`);
  console.log(`User ID: ${data.user_id}`);
})();
