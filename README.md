# Marketplace API

A small marketplace backend built with **Node.js**, **Fastify**, and **Supabase** (Postgres + Auth + Row Level Security).

## Entities

| Entity   | Fields                                              |
|----------|-----------------------------------------------------|
| Listings | id, title, price, seller_id, status, created_at     |
| Orders   | id, listing_id, buyer_id, status, created_at        |

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/marketplace-api.git
cd marketplace-api
npm install
```

### 2. Configure Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Go to **Project Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
3. Copy the env template and fill in values:

```bash
cp .env.example .env
```

### 3. Run the database migration

In the Supabase dashboard, open **SQL Editor** and paste the contents of:

```
supabase/migrations/20260305230000_initial_schema.sql
```

Run the script. This creates tables, RLS policies, and business-rule triggers.

Alternatively, if you use the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 4. Start the server

```bash
npm run dev
```

The API listens on `http://localhost:3000`.

## API Endpoints

| Method | Path                  | Auth | Description                          |
|--------|-----------------------|------|--------------------------------------|
| POST   | `/auth/signup`        | No   | Register a new user                  |
| POST   | `/auth/login`         | No   | Sign in, get access token            |
| GET    | `/health`             | No   | Health check                         |
| POST   | `/listings`           | Yes  | Create a listing                     |
| GET    | `/listings`           | No   | List all **active** listings         |
| PATCH  | `/listings/:id`       | Yes  | Update your own listing              |
| POST   | `/orders`             | Yes  | Place an order on a listing          |
| GET    | `/orders`             | Yes  | List your own orders                 |
| PATCH  | `/orders/:id/status`  | Yes  | Update order status                  |

Pass the JWT from login/signup as:

```
Authorization: Bearer <access_token>
```

## Example flow

```bash
# Register two users (seller and buyer)
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"seller@example.com","password":"secret12"}'

curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@example.com","password":"secret12"}'

# Seller creates a listing
curl -X POST http://localhost:3000/listings \
  -H "Authorization: Bearer SELLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Vintage Camera","price":150}'

# Anyone can browse active listings
curl http://localhost:3000/listings

# Buyer places an order (listing becomes "reserved")
curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing_id":"LISTING_UUID"}'

# Buyer views their orders
curl http://localhost:3000/orders \
  -H "Authorization: Bearer BUYER_TOKEN"

# Buyer or seller updates order status
curl -X PATCH http://localhost:3000/orders/ORDER_UUID/status \
  -H "Authorization: Bearer BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'
```

## Business rules

- A seller **cannot** order their own listing (enforced by a Postgres trigger).
- When an order is placed on an active listing, the listing status becomes **`reserved`**.
- When an order is **completed**, the listing becomes **`sold`**.
- When an order is **cancelled**, the listing returns to **`active`** (if no other open orders exist).

## Access control

Access control is enforced at the **database layer** via Supabase Row Level Security (RLS):

- **Listings**: anyone can read active listings; only the seller can insert/update their own rows.
- **Orders**: users can only read orders where they are the buyer; buyers and listing sellers can update order status.

The API forwards each user's JWT to Supabase, so Postgres policies apply on every query — not just in application code.

## Scripts

```bash
npm run dev        # Start with hot reload
npm run build      # Compile TypeScript
npm start          # Run compiled output
npm run typecheck  # Type-check without emitting
```

## Publish to GitHub

```bash
gh auth login
gh repo create marketplace-api --public --source=. --remote=origin --push
```

Or create a repo manually on GitHub, then:

```bash
git remote add origin git@github.com:YOUR_USERNAME/marketplace-api.git
git push -u origin master
```
