/**
 * One-time helper to exchange a Google OAuth authorization code for tokens.
 *
 * Usage:
 *   1. Copy .env from sample.env, fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
 *   2. Run: node setup.js
 *      (This prints the auth URL to open in your browser)
 *   3. After authorising, copy the 'code' parameter from the redirect URL
 *   4. Run: node setup.js YOUR_CODE_HERE
 *   5. The refresh token will be printed — add it to your .env / GitHub secrets
 */
require("dotenv").config();
const fetch = require("node-fetch");

const {
  GOOGLE_CLIENT_ID: clientId,
  GOOGLE_CLIENT_SECRET: clientSecret,
} = process.env;

const REDIRECT_URI = "http://localhost";
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
].join(" ");

const code = process.argv[2];
if (!code) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
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
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Token exchange failed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("Success! Here are your tokens:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
  console.log("Add the refresh token above to your .env file and GitHub Actions secrets.");
  console.log(`\nAccess token (expires in ${data.expires_in}s): ${data.access_token}`);
})();
