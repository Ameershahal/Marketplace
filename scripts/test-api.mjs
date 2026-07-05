#!/usr/bin/env node
/**
 * End-to-end API test suite.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env to seed confirmed test users
 * (avoids Supabase signup email rate limits).
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:3000";
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const ts = Date.now();
const sellerEmail = `seller-${ts}@example.com`;
const buyerEmail = `buyer-${ts}@example.com`;
const password = "testpass123";

let passed = 0;
let failed = 0;

function ok(msg) {
  passed++;
  console.log(`✅ ${msg}`);
}

function fail(msg, detail) {
  failed++;
  console.error(`❌ ${msg}`);
  if (detail) console.error("   ", detail);
}

async function request(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.cause?.code === "ECONNREFUSED") {
      throw new Error(
        `Cannot connect to ${BASE}. Start the API first: npm run dev`
      );
    }
    throw err;
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function seedUsers() {
  if (process.env.TEST_SELLER_TOKEN && process.env.TEST_BUYER_TOKEN) {
    return {
      sellerToken: process.env.TEST_SELLER_TOKEN,
      buyerToken: process.env.TEST_BUYER_TOKEN,
    };
  }

  const loginEmail = process.env.TEST_SELLER_EMAIL;
  const loginBuyer = process.env.TEST_BUYER_EMAIL;
  const loginPass = process.env.TEST_PASSWORD ?? password;
  if (loginEmail && loginBuyer) {
    const seller = await request("POST", "/auth/login", {
      body: { email: loginEmail, password: loginPass },
    });
    const buyer = await request("POST", "/auth/login", {
      body: { email: loginBuyer, password: loginPass },
    });
    if (seller.json?.session?.access_token && buyer.json?.session?.access_token) {
      return {
        sellerToken: seller.json.session.access_token,
        buyerToken: buyer.json.session.access_token,
      };
    }
    throw new Error(
      `Login failed: seller=${seller.json?.error}, buyer=${buyer.json?.error}`
    );
  }

  if (!serviceKey) {
    console.log("No SUPABASE_SERVICE_ROLE_KEY — trying public signup...");
    const seller = await request("POST", "/auth/signup", {
      body: { email: sellerEmail, password },
    });
    const buyer = await request("POST", "/auth/signup", {
      body: { email: buyerEmail, password },
    });

    if (seller.status === 201 && seller.json?.session?.access_token) {
      return {
        sellerToken: seller.json.session.access_token,
        buyerToken: buyer.json.session.access_token,
      };
    }

    throw new Error(
      seller.json?.error ??
        "Signup failed. Add SUPABASE_SERVICE_ROLE_KEY to .env (Supabase Dashboard → Settings → API) and re-run."
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const email of [sellerEmail, buyerEmail]) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error && !error.message.includes("already been registered")) {
      throw new Error(`Failed to create ${email}: ${error.message}`);
    }
  }

  const anon = createClient(url, anonKey);
  const { data: sellerData, error: sellerErr } =
    await anon.auth.signInWithPassword({ email: sellerEmail, password });
  const { data: buyerData, error: buyerErr } =
    await anon.auth.signInWithPassword({ email: buyerEmail, password });

  if (sellerErr || buyerErr || !sellerData.session || !buyerData.session) {
    throw new Error("Failed to sign in seeded users");
  }

  return {
    sellerToken: sellerData.session.access_token,
    buyerToken: buyerData.session.access_token,
  };
}

async function main() {
  console.log(`Testing API at ${BASE}\n`);

  // 1. Health
  const health = await request("GET", "/health");
  if (health.status === 200 && health.json?.status === "ok") ok("Health check");
  else fail("Health check", health.json);

  // 2. Seed users
  let sellerToken, buyerToken;
  try {
    ({ sellerToken, buyerToken } = await seedUsers());
    ok("Test users ready");
  } catch (e) {
    fail("User setup", e.message);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  // 3. Create listing
  const listing = await request("POST", "/listings", {
    token: sellerToken,
    body: { title: "Vintage Camera", price: 150 },
  });
  const listingId = listing.json?.id;
  if (listing.status === 201 && listingId && listing.json.status === "active") {
    ok(`Create listing (${listingId})`);
  } else fail("Create listing", listing.json);

  // 4. List active
  const active = await request("GET", "/listings");
  const inList = active.json?.some?.((l) => l.id === listingId);
  if (active.status === 200 && inList) ok("Listing appears in active list");
  else fail("List active listings", active.json);

  // 5. Self-order blocked
  const selfOrder = await request("POST", "/orders", {
    token: sellerToken,
    body: { listing_id: listingId },
  });
  if (selfOrder.status === 400) ok("Seller cannot order own listing");
  else fail("Self-order should be blocked", selfOrder.json);

  // 6. Buyer places order
  const order = await request("POST", "/orders", {
    token: buyerToken,
    body: { listing_id: listingId },
  });
  const orderId = order.json?.id;
  if (order.status === 201 && orderId && order.json.status === "pending") {
    ok(`Buyer placed order (${orderId})`);
  } else fail("Place order", order.json);

  // 7. Listing no longer active
  const activeAfter = await request("GET", "/listings");
  const stillActive = activeAfter.json?.some?.((l) => l.id === listingId);
  if (activeAfter.status === 200 && !stillActive) ok("Listing reserved (not in active list)");
  else fail("Listing should be reserved", activeAfter.json);

  // 8. Buyer sees own orders
  const buyerOrders = await request("GET", "/orders", { token: buyerToken });
  const buyerSees = buyerOrders.json?.some?.((o) => o.id === orderId);
  if (buyerOrders.status === 200 && buyerSees) ok("Buyer sees own order");
  else fail("Buyer order visibility", buyerOrders.json);

  // 9. Seller cannot see buyer orders
  const sellerOrders = await request("GET", "/orders", { token: sellerToken });
  const sellerSees = sellerOrders.json?.some?.((o) => o.id === orderId);
  if (sellerOrders.status === 200 && !sellerSees) ok("Seller cannot see buyer orders (RLS)");
  else fail("Seller should not see buyer orders", sellerOrders.json);

  // 10. Update status (buyer)
  const confirm = await request("PATCH", `/orders/${orderId}/status`, {
    token: buyerToken,
    body: { status: "confirmed" },
  });
  if (confirm.status === 200 && confirm.json?.status === "confirmed") {
    ok("Buyer updated order to confirmed");
  } else fail("Update order status (buyer)", confirm.json);

  // 11. Update status (seller)
  const complete = await request("PATCH", `/orders/${orderId}/status`, {
    token: sellerToken,
    body: { status: "completed" },
  });
  if (complete.status === 200 && complete.json?.status === "completed") {
    ok("Seller updated order to completed");
  } else fail("Update order status (seller)", complete.json);

  // 12. Seller edits own listing
  const edit = await request("PATCH", `/listings/${listingId}`, {
    token: sellerToken,
    body: { title: "Vintage Camera (Sold)" },
  });
  if (edit.status === 200 && edit.json?.title === "Vintage Camera (Sold)") {
    ok("Seller can edit own listing");
  } else fail("Edit own listing", edit.json);

  // 13. Buyer cannot edit listing
  const hijack = await request("PATCH", `/listings/${listingId}`, {
    token: buyerToken,
    body: { title: "Hijacked" },
  });
  if (hijack.status === 400 || hijack.status === 404) {
    ok("Buyer blocked from editing listing");
  } else fail("Buyer should not edit listing", hijack.json);

  // 14. Unauthenticated blocked
  const unauth = await request("POST", "/listings", {
    body: { title: "Hack", price: 1 },
  });
  if (unauth.status === 401) ok("Unauthenticated request rejected");
  else fail("Expected 401 for unauth", unauth.json);

  console.log(`\n${"=".repeat(30)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(30));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
