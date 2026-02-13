# Zynd AI x Privado ID Integration Architecture

## Overview

Zynd AI uses **Privado ID** (iden3 protocol) to provide decentralized identity (DID) and verifiable credentials to both human users and AI agents. The architecture combines:

1. **Privado ID Issuer Node** — Self-hosted issuer that creates an issuer DID and issues iden3 verifiable credentials.
2. **Privado ID JS SDK (`@0xpolygonid/js-sdk`)** — Used in the Agent Registry backend to create DIDs for users and agents client-side, with seed-based key management.

The result: every agent and user in the Zynd AI network has a cryptographic DID anchored on-chain, with verifiable credentials issued by the Zynd AI issuer that anyone can independently verify.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Zynd AI Platform                            │
│                                                                 │
│  ┌──────────────────────┐        ┌───────────────────────────┐  │
│  │   Agent Registry     │        │   Privado ID Issuer Node  │  │
│  │   (NestJS Backend)   │        │   (Self-Hosted)           │  │
│  │                      │        │                           │  │
│  │  ┌────────────────┐  │        │  - Issuer DID             │  │
│  │  │ Privado ID     │  │  APIs  │  - Credential Issuance    │  │
│  │  │ JS SDK         │──┼───────>│  - Connection Management  │  │
│  │  │                │  │        │  - State Publishing       │  │
│  │  │ - Create DIDs  │  │        │                           │  │
│  │  │ - Generate     │  │        └──────────┬────────────────┘  │
│  │  │   Seeds        │  │                   │                   │
│  │  └────────────────┘  │                   │ On-chain State    │
│  └──────────────────────┘                   │                   │
│                                             ▼                   │
│                              ┌──────────────────────────┐       │
│                              │  Blockchain Layer         │       │
│                              │  - Privado Main (21000)   │       │
│                              │  - Polygon Amoy (80002)   │       │
│                              └──────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                        ┌──────────────────────┐
                        │   Any Verifier       │
                        │   - Verify iden3     │
                        │     credentials      │
                        │   - Check human      │
                        │     anchor (owner)   │
                        └──────────────────────┘
```

---

## 1. Issuer Node Setup

The Privado ID Issuer Node is self-hosted and configured to operate on both **Privado mainnet** and **Polygon Amoy**.

### Issuer DID

The issuer creates its own DID on startup. This DID is the trust anchor — all credentials it issues are cryptographically tied to it.

```
Issuer DID: did:iden3:polygon:amoy:<identifier>
```

### Network Configuration (`resolvers_settings.yaml`)

```yaml
# Privado Identity Chain (mainnet)
- blockchain: privado
  network: main
  networkFlag: 0b01000001
  chainID: 21000
  contractAddress: "0x3C9acB2205Aa72A05F6D77d708b5Cf85FCa3a896"
  rpcUrl: "https://rpc-mainnet.privado.id"
  rhsSettings:
    mode: None

# Polygon Amoy (testnet)
- blockchain: polygon
  network: amoy
  networkFlag: 0b00010010
  chainID: 80002
  contractAddress: "0x1a4cC30f2aA0377b0c3bc9848766D90cb4404124"
  rpcUrl: "https://rpc-amoy.polygon.technology"
  gasLess: true
```

### Issuer Node Key Configuration

- **KMS Provider:** HashiCorp Vault (production) / Local storage (dev)
- **Key Types:** BabyJubJub (BJJ) for ZK proofs, Ethereum for blockchain transactions
- **State Publishing:** Automatic, frequency configurable (`ISSUER_ONCHAIN_PUBLISH_STATE_FREQUENCY=1m`)

---

## 2. Identity Creation with Privado ID JS SDK

The Agent Registry creates DIDs for users and agents using `@0xpolygonid/js-sdk` entirely on the backend. Each identity gets a **cryptographic seed** that the user retains for key recovery.

### Core Identity Module (`src/identity-wallet.ts`)

```typescript
import {
  BjjProvider, core, CredentialStatusType, CredentialStorage,
  CredentialWallet, EthStateStorage, IdentityStorage,
  IdentityWallet, InMemoryDataSource, InMemoryMerkleTreeStorage,
  InMemoryPrivateKeyStore, KMS, KmsKeyType,
} from "@0xpolygonid/js-sdk";

const RHS_URL = "https://rhs-staging.polygonid.me";

const defaultNetworkConnection = {
  url: "https://rpc.ankr.com/polygon_amoy",
  contractAddress: "0x1a4cC30f2aA0377b0c3bc9848766D90cb4404124",
  chainId: 80002,
};

export async function createIdentity(
  seed: Uint8Array
): Promise<{ identifier: string; did: string }> {
  const dataStorage = initInMemoryDataStorage({ ... });
  const credentialWallet = await initCredentialWallet(dataStorage);
  const memoryKeyStore = new InMemoryPrivateKeyStore();
  const identityWallet = await initIdentityWallet(
    dataStorage, credentialWallet, memoryKeyStore
  );

  const { did, credential } = await identityWallet.createIdentity({
    method: core.DidMethod.PolygonId,
    blockchain: core.Blockchain.Polygon,
    networkId: core.NetworkId.Amoy,
    seed: seed,
    revocationOpts: {
      id: RHS_URL,
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
    },
  });

  return {
    identifier: `did:${did.method}:${did.id}`,
    did: JSON.stringify(credential),
  };
}
```

### Seed Generation and Management

Seeds are generated server-side, stored encrypted in the database, and returned to the user so they can manage their identity independently.

```typescript
export function generateSeed(length: number = 32): Uint8Array {
  const seed = new Uint8Array(length);
  crypto.getRandomValues(seed);
  return seed;
}

export function seedToBase64(seed: Uint8Array): string {
  return btoa(String.fromCharCode(...seed));
}

export function base64ToSeed(base64: string): Uint8Array {
  return new Uint8Array([...atob(base64)].map((c) => c.charCodeAt(0)));
}
```

The 32-byte seed deterministically derives the BabyJubJub keypair, meaning anyone with the seed can reconstruct the DID and sign on its behalf.

---

## 3. AI Identity Credential Schema

A custom **"AI Identity Schema"** is hosted on IPFS and used as the single credential type issued to both users and agents. The schema includes an `owner` field that anchors a human DID to every identity — enabling verifiable human accountability.

**Schema URL (IPFS):**
```
https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreibcxbp5mhdj5nmc6vpycej2ntdhcoyge53avf6zojbvwlybj7l32e
```

**JSON-LD Context:**
```
https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreiaepdlivs45mm5pvou4thy5a6fe7sajtkiu55b7xnhzxhbjfpelx4
```

**Schema Definition:**

```json
{
  "$metadata": {
    "uris": {
      "jsonLdContext": "https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreiaepdlivs45mm5pvou4thy5a6fe7sajtkiu55b7xnhzxhbjfpelx4"
    },
    "version": "1.0",
    "type": "Identity"
  },
  "description": "Identity schema for AI Agents on Zynd AI network",
  "title": "AI Identity Schema",
  "properties": {
    "credentialSubject": {
      "description": "Stores the data of the credential",
      "title": "Credential subject",
      "properties": {
        "id": {
          "description": "Stores the DID of the subject that owns the credential",
          "title": "Credential subject ID",
          "format": "uri",
          "type": "string"
        },
        "owner": {
          "description": "Stores the DID of the Owner that created this agent",
          "title": "Credential subject ID",
          "type": "string"
        },
        "skills": {
          "description": "list of skills in which the AI is expert",
          "title": "list of skills",
          "type": "object"
        }
      },
      "required": ["owner"],
      "type": "object"
    }
  }
}
```

### Credential Subject Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | DID of the subject (agent or user) receiving the credential |
| `owner` | Yes | DID of the **human owner** who created the agent. For users, `owner` = their own DID. For agents, `owner` = the creating user's DID. This is the **human anchor**. |
| `skills` | No | JSON object listing the AI agent's capabilities/expertise |

### Owner Field — Human Anchor

The `owner` field is the critical trust bridge:

- **For Users:** `owner` = the user's own DID (self-referencing, proves identity was issued by Zynd AI)
- **For Agents:** `owner` = the user's DID who registered the agent (proves a verified human is accountable for this agent)

Any verifier can check the `owner` field to trace an agent back to its human creator, establishing a verifiable chain of accountability without revealing the human's real-world identity.

---

## 4. End-to-End Flow: User Registration

### Step-by-Step

1. **Wallet Signature** — User signs a message with their Ethereum wallet.
2. **Signature Verification** — Backend verifies using `ethers.recoverAddress`.
3. **DID Creation** — A new 32-byte seed is generated, and `createIdentity(seed)` produces a PolygonID DID via the JS SDK.
4. **Database Record** — User is stored with `walletAddress`, `didIdentifier`, `did`, and `seed` (base64).
5. **Issuer Connection** — A connection is established between the user's DID and the issuer node.
6. **Credential Issuance** — An "Identity" credential is issued from the issuer to the user's DID.

### Code (`src/auth/auth.service.ts`)

```typescript
async login(wallet_address: string, signature: string, message: string) {
  // 1. Verify wallet signature
  const msgHash = ethers.hashMessage(message);
  const recoveredAddress = ethers.recoverAddress(msgHash, signature);
  if (recoveredAddress !== wallet_address) {
    throw new BadRequestException("Invalid signature!");
  }

  let user = await this.prismaService.user.findUnique({
    where: { walletAddress: wallet_address },
  });

  if (!user) {
    // 2. Generate seed and create DID
    const newSeed = generateSeed();
    const newIdentity = await createIdentity(newSeed);

    // 3. Store user with DID
    user = await this.prismaService.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          walletAddress: wallet_address,
          didIdentifier: newIdentity.identifier,
          did: newIdentity.did,
          seed: seedToBase64(newSeed),
        },
      });

      // 4. Create connection with issuer
      await this.createConnection(createdUser.didIdentifier, createdUser.did);
      const connectionId = await this.getConnection(createdUser.didIdentifier);

      await tx.user.update({
        where: { id: createdUser.id },
        data: { connectionString: connectionId },
      });

      return createdUser;
    });

    // 5. Issue identity credential
    await this.issueCredential(user.didIdentifier);
  }

  return { access_token: this.jwtService.sign({ ... }) };
}
```

---

## 5. End-to-End Flow: Agent Registration

### Step-by-Step

1. **API Key Auth** — Agent creation requires a valid API key (user must be authenticated).
2. **DID Creation** — A new seed is generated and a PolygonID DID is created via the JS SDK.
3. **Database Record** — Agent is stored with `didIdentifier`, `did`, `seed` (base64), and owner reference.
4. **Issuer Connection** — Connection between agent DID and issuer node is established.
5. **Credential Issuance** — An "Identity" credential is issued to the agent's DID, anchoring the owner's identity.

### Code (`src/agents/agents.service.ts`)

```typescript
async createAgent(userId: string, createAgentDto: CreateAgentDto) {
  // 1. Generate identity
  const newSeed = generateSeed();
  const newIdentity = await createIdentity(newSeed);

  // 2. Create agent in database
  const agent = await this.prismaService.$transaction(async (tx) => {
    const createdAgent = await tx.agent.create({
      data: {
        didIdentifier: newIdentity.identifier,
        did: newIdentity.did,
        seed: seedToBase64(newSeed),
        name: createAgentDto.name,
        description: createAgentDto.description,
        capabilities: createAgentDto.capabilities,
        ownerId: userId,
      },
    });
    return createdAgent;
  });

  // 3. External calls (parallel)
  await Promise.all([
    // Create connection + store connectionId
    this.createConnection(agent.didIdentifier, agent.did)
      .then(() => this.getConnection(agent.didIdentifier))
      .then((connectionId) =>
        this.prismaService.agent.update({
          where: { id: agent.id },
          data: { connectionString: connectionId },
        })
      ),
    // Issue identity credential
    this.issueCredential(agent.didIdentifier),
  ]);

  return finalAgent;
}
```

---

## 6. Issuer Node API Integration

The Agent Registry communicates with the Issuer Node via three REST API calls:

### 6.1 Create Connection

Establishes a trust link between the issuer and the user/agent DID.

```typescript
async createConnection(userDIDIdentifier: string, userDID: string) {
  await fetch(
    `${issuerUrl}/v2/identities/${issuerDIDIdentifier}/connections`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userDID: userDIDIdentifier,
        userDoc: JSON.parse(userDID),
        issuerDoc: JSON.parse(userDID),
      }),
    }
  );
}
```

**Issuer Node API:** `POST /v2/identities/{issuerDID}/connections`

### 6.2 Get Connection ID

Retrieves the connection ID for subsequent credential issuance.

```typescript
async getConnection(userDIDIdentifier: string) {
  const resp = await fetch(
    `${issuerUrl}/v2/identities/${issuerDIDIdentifier}/connections?query=${userDIDIdentifier}&page=1&max_results=1`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${tokenBase64}`,
      },
    }
  );
  const data = await resp.json();
  return data.items[0].id;
}
```

**Issuer Node API:** `GET /v2/identities/{issuerDID}/connections?query=<DID>`

### 6.3 Issue Credential

Issues an iden3 verifiable credential using the **AI Identity Schema**.

**For Users** — `owner` is the user's own DID (self-referencing):

```typescript
// src/auth/auth.service.ts
async issueCredential(userDIDIdentifier: string) {
  const bodyData = {
    credentialSchema: process.env.USER_IDENTITY_SCHEMA_URL,
    credentialSubject: {
      id: userDIDIdentifier,
      owner: userDIDIdentifier,  // user owns themselves
    },
    expiration: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    proofs: ["Iden3SparseMerkleTreeProof", "BJJSignature2021"],
    refreshService: null,
    type: "Identity",
  };

  await fetch(
    `${issuerUrl}/v2/identities/${issuerDIDIdentifier}/credentials`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${tokenBase64}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyData),
    }
  );
}
```

**For Agents** — `owner` is the **human user's DID** who created the agent:

```typescript
// src/agents/agents.service.ts
async issueCredential(agentDIDIdentifier: string) {
  const bodyData = {
    credentialSchema: process.env.USER_IDENTITY_SCHEMA_URL,
    credentialSubject: {
      id: agentDIDIdentifier,
      owner: agentDIDIdentifier,  // the creating user's DID is anchored here
    },
    expiration: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    proofs: ["Iden3SparseMerkleTreeProof", "BJJSignature2021"],
    refreshService: null,
    type: "Identity",
  };

  await fetch(
    `${issuerUrl}/v2/identities/${issuerDIDIdentifier}/credentials`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${tokenBase64}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyData),
    }
  );
}
```

**Issuer Node API:** `POST /v2/identities/{issuerDID}/credentials`

**Credential Properties:**
| Field | Value |
|-------|-------|
| Schema | `https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreibcxbp5mhdj5nmc6vpycej2ntdhcoyge53avf6zojbvwlybj7l32e` |
| Type | `Identity` |
| Proofs | `Iden3SparseMerkleTreeProof`, `BJJSignature2021` |
| Expiration | 1 year from issuance |
| `credentialSubject.id` | DID of the agent or user receiving the credential |
| `credentialSubject.owner` | **Human anchor** — the DID of the human owner (user's own DID for users, creator's DID for agents) |
| `credentialSubject.skills` | (Optional) JSON object of agent capabilities |

---

## 7. Data Model

### User Table

| Field | Type | Description |
|-------|------|-------------|
| `walletAddress` | String (unique) | Ethereum wallet address |
| `didIdentifier` | String (unique) | Privado ID DID (`did:iden3:polygon:amoy:...`) |
| `did` | String | Full DID credential document (JSON) |
| `seed` | String | Base64-encoded 32-byte seed for key recovery |
| `connectionString` | String | Issuer node connection ID |

### Agent Table

| Field | Type | Description |
|-------|------|-------------|
| `didIdentifier` | String (unique) | Privado ID DID |
| `did` | String (unique) | Full DID credential document (JSON) |
| `seed` | String (unique) | Base64-encoded seed (returned to user) |
| `connectionString` | String | Issuer node connection ID |
| `ownerId` | String (FK) | Reference to the owning User |
| `name` | String | Agent name |
| `capabilities` | JSON | Agent capabilities |

---

## 8. Verification

Anyone can verify the credentials issued by the Zynd AI issuer:

1. **Credential Verification** — Using iden3 proof verification, any verifier can check that the credential was issued by the Zynd AI issuer DID and has not been revoked.
2. **Human Anchor** — The `owner` field in the credential subject links the agent's DID to its human owner, establishing a verifiable chain of accountability.
3. **On-chain State** — The issuer's state (merkle tree roots) is published on-chain, enabling trustless verification without contacting the issuer.
4. **Revocation Check** — Credential revocation status is verifiable via the Reverse Hash Service (RHS) or on-chain sparse merkle tree proofs.

### Verification Flow

```
Verifier                    Blockchain                  RHS
   │                            │                        │
   │  1. Get issuer state       │                        │
   │ ──────────────────────────>│                        │
   │  (Claims/Revocation roots) │                        │
   │ <──────────────────────────│                        │
   │                            │                        │
   │  2. Verify merkle proof against state               │
   │  (local computation)                                │
   │                                                     │
   │  3. Check revocation status                         │
   │ ───────────────────────────────────────────────────>│
   │ <───────────────────────────────────────────────────│
   │                                                     │
   │  ✅ Credential verified                             │
```

---

## 9. Technology Stack

| Component | Technology |
|-----------|-----------|
| Agent Registry Backend | NestJS (TypeScript) |
| DID Creation | `@0xpolygonid/js-sdk` v1.27.1 |
| Auth Verification | `@iden3/js-iden3-auth` v1.6.0 |
| Issuer Node | Privado ID Issuer Node (Go) |
| KMS | HashiCorp Vault |
| Blockchain | Polygon Amoy (testnet), Privado Main |
| State Contract | `0x1a4cC30f2aA0377b0c3bc9848766D90cb4404124` (Amoy) |
| Credential Schema | IPFS (Pinata) |
| Database | PostgreSQL (Prisma ORM) |
| Key Type | BabyJubJub (BJJ) for ZK proofs |

---

## 10. Environment Configuration

```env
# Issuer Node Connection
ISSUER_NODE_URL="http://<issuer-host>:3001"
ISSUER_USERNAME="user-issuer"
ISSUER_PASSWORD="password-issuer"
ISSUER_DID_IDENTIFIER="did:iden3:polygon:amoy:<identifier>"

# AI Identity Schema (IPFS-hosted)
USER_IDENTITY_SCHEMA_URL="https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreibcxbp5mhdj5nmc6vpycej2ntdhcoyge53avf6zojbvwlybj7l32e"
```

**Schema URL:** [https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreibcxbp5mhdj5nmc6vpycej2ntdhcoyge53avf6zojbvwlybj7l32e](https://jade-content-mollusk-671.mypinata.cloud/ipfs/bafkreibcxbp5mhdj5nmc6vpycej2ntdhcoyge53avf6zojbvwlybj7l32e)

---

## Summary

Zynd AI integrates Privado ID at two levels:

- **Issuer Node** — Acts as the trusted credential issuer for the Zynd AI network. Creates the issuer DID, manages connections, and issues iden3 verifiable credentials to all participants.
- **JS SDK** — Creates individual DIDs for users and agents client-side with deterministic seed-based key derivation. Seeds are returned to users for self-sovereign identity management.

Every user and agent in the Zynd AI network receives a cryptographic DID and a verifiable credential from the Zynd AI issuer, enabling trustless, on-chain-verifiable identity across the ecosystem.
