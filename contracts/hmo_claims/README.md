# HMO Claims Soroban Contract

A Soroban smart contract for automated HMO/NHIA claim verification and payout.

## Privacy

- **No patient identity on-chain.** Only pseudonymous 32-byte policy IDs and opaque
  reference IDs (derived from invoice ObjectIds) are stored. No names, dates of birth,
  or clinical data ever touch the Stellar ledger.
- Service codes are numeric (`u32`) only.

## Functions

| Function | Access | Description |
|---|---|---|
| `register_policy` | Admin | Register/update a policy with coverage rules and limits |
| `deactivate_policy` | Admin | Mark a policy inactive |
| `get_policy` | Read | Fetch policy by pseudonymous policy_id |
| `submit_claim` | Billing | Submit and auto-verify a claim; emits event |
| `get_claim` | Read | Fetch claim by opaque reference ID |

## Rejection reason codes

| Code | Meaning |
|---|---|
| 1001 | Policy not found |
| 1002 | Service code not covered |
| 1003 | Amount exceeds policy limit |
| 1004 | (reserved) |
| 1005 | Policy inactive |

## Run tests

```bash
cd contracts/hmo_claims
cargo test --features testutils
```

## Build and deploy to Testnet

### Prerequisites

```bash
# Install Stellar CLI (version ≥22)
cargo install --locked stellar-cli
rustup target add wasm32-unknown-unknown
```

### 1. Generate a deployer keypair and fund with Friendbot

```bash
stellar keys generate --global hmo-deployer --network testnet
stellar keys address hmo-deployer          # copy the G... address
# Fund it:
curl "https://friendbot.stellar.org?addr=$(stellar keys address hmo-deployer)"
```

### 2. Build the contract

```bash
cd contracts/hmo_claims
stellar contract build
# Output: target/wasm32-unknown-unknown/release/hmo_claims.wasm
```

### 3. Deploy to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hmo_claims.wasm \
  --source hmo-deployer \
  --network testnet
```

The command prints a contract ID starting with `C...`. Copy it.

### 4. Store the contract ID in backend/.env

```
HMO_CONTRACT_ID=C...  # paste the contract ID here
```

### 5. Verify the deployment

```bash
stellar contract invoke \
  --id $HMO_CONTRACT_ID \
  --source hmo-deployer \
  --network testnet \
  -- get_policy \
  --policy_id 0000000000000000000000000000000000000000000000000000000000000000
# Returns null — confirms contract is live
```

## README alignment

The README quick-start section already documents these steps correctly under
"3. Smart contracts (optional, blockchain contributors)". The commands above
match the documented workflow exactly — no README changes needed.
