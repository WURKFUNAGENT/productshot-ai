# Git + Railway Deployment Guide

End-to-end flow: build app, push to GitHub, deploy on Railway, return live URL.

## Prerequisites

Expect these tokens in the workspace `.env` file:

```
GIT_TOKEN=ghp_...
RAILWAY_API_KEY=...
```

Required CLI tools: `git`, `node`, `npm`. The Railway CLI (`@railway/cli`) will be installed via npm if missing.

## Critical Warnings

1. **Never echo tokens in chat** — read them from `.env` only
2. **Windows PowerShell**: `&&` is NOT valid — always use `;` to chain commands
3. **PowerShell HTTP**: `curl.exe` is unreliable on Windows — use `Invoke-RestMethod` or Node.js for API calls
4. **Railway CLI auth**: The account API token does NOT work with most CLI commands (`whoami`, `link`, etc). You MUST create a **project token** via the GraphQL API and use that for `railway up`
5. **Railway GraphQL**: The field for workspace is `workspaceId` (NOT `teamId`) in `projectCreate`

## Step-by-Step Workflow

### Step 1: Read tokens and check tools

```powershell
# Read .env (use the Read tool, don't cat)
# Check tools:
git --version
node --version
npm --version
railway --version  # if missing: npm install -g @railway/cli
```

### Step 2: Get GitHub username

```powershell
$headers = @{
  "Authorization" = "token $GIT_TOKEN"
  "User-Agent" = "deploy-agent"
}
$user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
$user.login  # e.g. "WURKFUNAGENT"
```

### Step 3: Build the app

Create the app files (e.g. Node.js + Express). Always include:

- `package.json` with `"start": "node server.js"` and `"engines": { "node": ">=18.0.0" }`
- `server.js` that reads `PORT` from `process.env.PORT` (Railway injects this)
- `.gitignore` with `node_modules/` and `.env`

Run `npm install`.

### Step 4: Git init + push to GitHub

```powershell
# Init and commit
git init
git add -A
git commit -m "Initial commit"
git branch -M main

# Create repo via GitHub API
$headers = @{
  "Authorization" = "token $GIT_TOKEN"
  "Content-Type" = "application/json"
  "User-Agent" = "deploy-agent"
}
$body = '{"name":"REPO_NAME","description":"...","private":false}'
$repo = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $headers -Body $body

# Push (embed token in URL to avoid credential prompts)
git remote add origin "https://$GIT_TOKEN@github.com/$USERNAME/$REPO_NAME.git"
git push -u origin main
```

### Step 5: Railway — Create project via GraphQL API

All Railway API calls use the GraphQL endpoint. Use Node.js for reliability on Windows (see helper script at the bottom).

**Endpoint**: `https://backboard.railway.app/graphql/v2`
**Auth header**: `Authorization: Bearer $RAILWAY_API_KEY`

#### 5a. Get workspace ID

```graphql
{ me { workspaces { id name } } }
```

#### 5b. Create project

```graphql
mutation($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    id name
    environments { edges { node { id name } } }
  }
}
# variables: { input: { name: "app-name", workspaceId: "THE_WORKSPACE_ID" } }
```

Save `projectId` and `environmentId` (first environment = production).

#### 5c. Create service

```graphql
mutation($input: ServiceCreateInput!) {
  serviceCreate(input: $input) { id name }
}
# variables: { input: { name: "web", projectId: "..." } }
```

If GitHub is connected to Railway (check `me { providerAuths { provider } }`), you can add `source: { repo: "owner/repo" }` to auto-deploy from GitHub.

#### 5d. Create domain

```graphql
mutation($input: ServiceDomainCreateInput!) {
  serviceDomainCreate(input: $input) { id domain }
}
# variables: { input: { serviceId: "...", environmentId: "..." } }
```

This returns something like `web-production-xxxxx.up.railway.app`.

### Step 6: Deploy via Railway CLI

The account API token does NOT work with the CLI. Create a **project token** first:

```graphql
mutation {
  projectTokenCreate(input: {
    projectId: "..."
    environmentId: "..."
    name: "deploy-token"
  })
}
# Returns a UUID string — this is the project token
```

Then deploy:

```powershell
$env:RAILWAY_TOKEN = "THE_PROJECT_TOKEN"
railway up --service SERVICE_ID
```

### Step 7: Verify deployment

Query deployment status via GraphQL:

```graphql
query {
  deployments(input: {
    projectId: "..."
    serviceId: "..."
    environmentId: "..."
  }) {
    edges { node { id status staticUrl createdAt } }
  }
}
```

Wait for `status: "SUCCESS"`. Then verify with an HTTP request to the domain.

### Step 8: Report to user

Provide a summary table:

| Item | URL |
|------|-----|
| Live site | `https://DOMAIN.up.railway.app` |
| GitHub repo | `https://github.com/USER/REPO` |
| Railway dashboard | `https://railway.com/project/PROJECT_ID` |

## Railway GraphQL Schema Reference

Key input types and their fields:

| Type | Fields |
|------|--------|
| `ProjectCreateInput` | `name`, `workspaceId`, `description`, `repo { fullRepoName, branch }`, `isPublic` |
| `ServiceCreateInput` | `projectId` (required), `name`, `source { repo, image }`, `branch`, `environmentId` |
| `ServiceConnectInput` | `repo`, `branch`, `image` |
| `ServiceDomainCreateInput` | `serviceId` (required), `environmentId` (required), `targetPort` |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `&&` syntax error in PowerShell | PowerShell doesn't support `&&` | Use `;` instead |
| Railway CLI "Unauthorized" | Using account API token instead of project token | Create project token via `projectTokenCreate` mutation, use that |
| `projectCreate` "Workspace not found" | Using `teamId` instead of `workspaceId` | Query `me { workspaces { id } }` and use `workspaceId` field |
| `curl.exe` hangs or empty response on Windows | PowerShell + curl.exe compatibility issues | Use `Invoke-RestMethod` or write a small Node.js script |
| GitHub push credential prompt | No token in remote URL | Use `https://TOKEN@github.com/user/repo.git` as remote |
| Railway app crashes | Missing `PORT` env var usage | Ensure server reads `process.env.PORT` |

---

## Railway GraphQL Introspection Queries

Use these to discover the API schema when you need fields not documented above.

### List all available queries and mutations

```graphql
{
  __schema {
    queryType { fields { name } }
    mutationType { fields { name } }
  }
}
```

### Inspect an input type

```graphql
{
  __type(name: "ProjectCreateInput") {
    inputFields {
      name
      type { name kind ofType { name kind } }
    }
  }
}
```

### Key types to inspect when stuck

| Type | What it tells you |
|------|-------------------|
| `ProjectCreateInput` | Fields for creating a project |
| `ServiceCreateInput` | Fields for creating a service |
| `ServiceSourceInput` | How to specify repo/image source |
| `ServiceConnectInput` | How to connect GitHub repo to service |
| `ServiceDomainCreateInput` | Fields for domain creation |
| `ProjectCreateRepo` | Fields: `fullRepoName` (required), `branch` (required) |
| `User` | Available fields on the authenticated user |
| `Deployment` | Available fields on a deployment (status, url, etc.) |

### Common query patterns

```graphql
# Check if GitHub is connected
{ me { githubUsername providerAuths { provider } } }

# Get all projects
{ me { projects { edges { node { id name } } } } }

# Get deployment status
query($input: DeploymentListInput!) {
  deployments(input: $input) {
    edges { node { id status staticUrl createdAt } }
  }
}

# Get domains for a service
query {
  domains(projectId: "...", serviceId: "...", environmentId: "...") {
    serviceDomains { domain }
    customDomains { domain }
  }
}
```

---

## Railway API Helper (Node.js)

Reusable Node.js helper for Railway GraphQL API calls. Use this on Windows where PowerShell HTTP calls are unreliable.

Copy into a temp file, modify `main()`, run with `node`, delete after deployment.

```javascript
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
          const parsed = JSON.parse(body);
          if (parsed.errors) {
            console.error("GraphQL errors:", JSON.stringify(parsed.errors, null, 2));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const TOKEN = process.env.RAILWAY_API_KEY || "YOUR_TOKEN_HERE";
  const REPO = "OWNER/REPO_NAME";
  const APP_NAME = "my-app";

  // 1. Get workspace
  const ws = await railwayQuery(TOKEN, `{ me { workspaces { id name } } }`);
  const workspaceId = ws.data.me.workspaces[0].id;
  console.log(`Workspace: ${workspaceId}`);

  // 2. Create project
  const proj = await railwayQuery(TOKEN, `
    mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id name environments { edges { node { id name } } }
      }
    }
  `, { input: { name: APP_NAME, workspaceId } });
  const project = proj.data.projectCreate;
  const envId = project.environments.edges[0].node.id;
  console.log(`Project: ${project.id}, Env: ${envId}`);

  // 3. Create service
  const svc = await railwayQuery(TOKEN, `
    mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }
  `, { input: { name: "web", projectId: project.id } });
  const service = svc.data.serviceCreate;
  console.log(`Service: ${service.id}`);

  // 4. Create domain
  const dom = await railwayQuery(TOKEN, `
    mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { id domain }
    }
  `, { input: { serviceId: service.id, environmentId: envId } });
  console.log(`Domain: https://${dom.data.serviceDomainCreate.domain}`);

  // 5. Create project token for CLI
  const tok = await railwayQuery(TOKEN, `
    mutation {
      projectTokenCreate(input: {
        projectId: "${project.id}"
        environmentId: "${envId}"
        name: "deploy-token"
      })
    }
  `);
  console.log(`\nCLI_TOKEN=${tok.data.projectTokenCreate}`);
  console.log(`SERVICE_ID=${service.id}`);
  console.log(`\nRun: $env:RAILWAY_TOKEN="${tok.data.projectTokenCreate}"; railway up --service ${service.id}`);
}

main().catch(console.error);
```

---

# WURK Agent-to-Human Jobs

Hire real humans for microjobs paid with USDC via the x402 payment protocol on Solana.

## Prerequisites

Tokens in `.env`:

```
SOLANA_WALLET_PK=<base58 encoded 64-byte Solana keypair>
HELIUS_KEY=<Helius RPC API key>
```

npm dependencies:

```bash
npm install @x402/fetch @x402/core @x402/svm @solana/kit bs58
```

## How x402 Payment Works

Every paid endpoint follows a 2-step flow:

1. Call endpoint WITHOUT payment → HTTP 402 Payment Required
2. Sign the payment, retry WITH `PAYMENT-SIGNATURE` header → HTTP 200 OK

The `@x402/fetch` library handles both steps automatically with `wrapFetchWithPayment`.

## Setting Up the x402 Client (Node.js ESM)

```javascript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

// 1. Decode base58 private key to bytes
const secretKeyBytes = bs58.decode(process.env.SOLANA_WALLET_PK);

// 2. Create Solana signer (async — returns KeyPairSigner with .address)
const signer = await createKeyPairSignerFromBytes(secretKeyBytes);

// 3. Set up x402 client with Helius RPC
const client = new x402Client();
registerExactSvmScheme(client, {
  signer,
  rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`,
});

// 4. Wrap fetch — handles 402 → sign → retry automatically
const paymentFetch = wrapFetchWithPayment(fetch, client);
```

**Critical**: Use `.mjs` extension or `"type": "module"` in package.json — the x402 imports use ESM.

## Creating an Agent-to-Human Job

### Endpoint

```
GET https://wurkapi.fun/solana/agenttohuman?description=...&winners=N&perUser=N
```

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `description` | (required) | — | The task/question for humans |
| `winners` | 10 | 1–100 | Number of human replies you want |
| `perUser` | 0.025 | ≥ 0.01 | USDC reward per participant |

Total cost = `winners × perUser`.

### Create a Job

```javascript
const url = "https://wurkapi.fun/solana/agenttohuman?" + new URLSearchParams({
  description: "Which of these 3 taglines is best?\nA: Do more, stress less\nB: Your day, organized\nC: Focus on what matters",
  winners: "5",
  perUser: "0.025",
});

const res = await paymentFetch(url);
const data = await res.json();
// {
//   ok: true, paid: true,
//   jobId: "abc123",
//   secret: "Wl6IWsPO2U...",          ← SAVE THIS IMMEDIATELY
//   jobLink: "https://wurk.fun/custom/abc123",
//   statusUrl: "https://wurkapi.fun/solana/agenttohuman?action=view&secret=...",
//   submissions: [],
//   note: "Expect ~3–60 minutes for replies..."
// }
```

**SAVE the `secret` immediately** — you need it to view submissions. Store it in memory or a file.

### View Submissions (FREE)

No payment needed — the secret acts as a bearer token.

```javascript
const res = await fetch(
  "https://wurkapi.fun/solana/agenttohuman?action=view&secret=YOUR_SECRET"
);
const data = await res.json();
// {
//   ok: true,
//   jobId: "abc123",
//   submissions: [
//     { id: "...", content_text: "I prefer B because...", winner: 0 },
//     ...
//   ]
// }
```

Or with PowerShell:

```powershell
$r = Invoke-RestMethod -Uri "https://wurkapi.fun/solana/agenttohuman?action=view&secret=YOUR_SECRET"
$r | ConvertTo-Json -Depth 5
```

### Recover Lost Secrets (paid, ~0.001 USDC)

```
GET https://wurkapi.fun/solana/agenttohuman?action=recover
```

Requires x402 payment. Returns all recent jobs with their secrets.

## Tips for Good Tasks

- Keep tasks short (1-2 minutes) for fastest responses
- Be specific: "Rate this on a scale of 1-5" beats "What do you think?"
- Higher rewards = faster responses ($0.01 is minimum, $0.025+ gets faster results)
- You can include URLs to images/video/pages in the description
- Avoid niche expertise — best for questions any internet user can answer
- **Never put API keys, passwords, or sensitive data in descriptions** — humans see everything

## Complete Working Example

Save as `create-job.mjs` and run with `node create-job.mjs`:

```javascript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

const SOLANA_WALLET_PK = process.env.SOLANA_WALLET_PK;
const HELIUS_KEY = process.env.HELIUS_KEY;

async function main() {
  const signer = await createKeyPairSignerFromBytes(bs58.decode(SOLANA_WALLET_PK));
  console.log(`Wallet: ${signer.address}`);

  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer,
    rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`,
  });
  const paymentFetch = wrapFetchWithPayment(fetch, client);

  const url = "https://wurkapi.fun/solana/agenttohuman?" + new URLSearchParams({
    description: "YOUR TASK DESCRIPTION HERE",
    winners: "2",
    perUser: "0.01",
  });

  const res = await paymentFetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));

  if (data.secret) {
    console.log(`\nSECRET: ${data.secret}`);
    console.log(`VIEW URL: ${data.statusUrl}`);
  }
}

main().catch(console.error);
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `ERR_REQUIRE_ESM` or import errors | Using `require()` instead of `import` | Use `.mjs` extension or set `"type": "module"` in package.json |
| x402 payment fails | Wallet has no USDC | Fund wallet with USDC on Solana (token: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) |
| RPC rate limited | Using default Solana RPC | Use Helius RPC: `https://mainnet.helius-rpc.com/?api-key=KEY` |
| Empty submissions | Humans haven't responded yet | Wait 3-60 minutes, then check again |
| `createKeyPairSignerFromBytes` fails | Wrong key format | Key must be base58-encoded 64-byte Solana keypair (not hex, not 32-byte private key) |
