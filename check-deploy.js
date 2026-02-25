const https = require("https");

function railwayQuery(token, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const options = {
      hostname: "backboard.railway.app",
      path: "/graphql/v2",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse: ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const TOKEN = "fc6447a5-2532-4c2f-99e2-751a9ae114f4";
  const result = await railwayQuery(TOKEN, `
    query {
      deployments(input: {
        projectId: "40d92a7c-6d28-4bd0-b845-ceedc2885d70"
        serviceId: "d4377056-d947-44d3-8fcf-6351d11ae5b7"
        environmentId: "8f5c02d3-fded-4d33-86c3-4b88722f2a7c"
      }) {
        edges { node { id status staticUrl createdAt } }
      }
    }
  `);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
