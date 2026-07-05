-- Marketplace schema with RLS and business-rule triggers

CREATE TYPE listing_status AS ENUM ('active', 'reserved', 'sold', 'inactive');
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) > 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status listing_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status order_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_buyer_not_seller CHECK (buyer_id IS NOT NULL)
);

CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_seller_id ON listings(seller_id);
CREATE INDEX idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX idx_orders_listing_id ON orders(listing_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Business rule: seller cannot order own listing; reserve listing on order
CREATE OR REPLACE FUNCTION enforce_order_business_rules()
RETURNS TRIGGER AS $$
DECLARE
  v_seller_id UUID;
  v_listing_status listing_status;
BEGIN
  SELECT seller_id, status
  INTO v_seller_id, v_listing_status
  FROM listings
  WHERE id = NEW.listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF v_seller_id = NEW.buyer_id THEN
    RAISE EXCEPTION 'Seller cannot order their own listing';
  END IF;

  IF v_listing_status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available for ordering (status: %)', v_listing_status;
  END IF;

  UPDATE listings
  SET status = 'reserved'
  WHERE id = NEW.listing_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER orders_enforce_business_rules
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_order_business_rules();

-- When order completes, mark listing as sold; when cancelled, reactivate if no other active orders
CREATE OR REPLACE FUNCTION sync_listing_status_on_order_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    UPDATE listings SET status = 'sold' WHERE id = NEW.listing_id;
  ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    IF NOT EXISTS (
      SELECT 1 FROM orders
      WHERE listing_id = NEW.listing_id
        AND id <> NEW.id
        AND status NOT IN ('cancelled', 'completed')
    ) THEN
      UPDATE listings SET status = 'active' WHERE id = NEW.listing_id AND status = 'reserved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER orders_sync_listing_status
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION sync_listing_status_on_order_update();

-- Row Level Security
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Listings: anyone can read active listings
CREATE POLICY listings_select_active ON listings
  FOR SELECT
  USING (status = 'active');

-- Sellers can read all of their own listings (any status)
CREATE POLICY listings_select_own ON listings
  FOR SELECT
  USING (seller_id = auth.uid());

-- Authenticated users can create listings for themselves only
CREATE POLICY listings_insert_own ON listings
  FOR INSERT
  WITH CHECK (seller_id = auth.uid());

-- Sellers can update only their own listings
CREATE POLICY listings_update_own ON listings
  FOR UPDATE
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Orders: buyers see only their own orders (buyer_id = auth.uid())
CREATE POLICY orders_select_own ON orders
  FOR SELECT
  USING (buyer_id = auth.uid());

-- Buyers can create orders for themselves only
CREATE POLICY orders_insert_own ON orders
  FOR INSERT
  WITH CHECK (buyer_id = auth.uid());

-- Buyers and sellers involved in the order can update status
CREATE POLICY orders_update_participants ON orders
  FOR UPDATE
  USING (
    buyer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = orders.listing_id
        AND listings.seller_id = auth.uid()
    )
  )
  WITH CHECK (
    buyer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = orders.listing_id
        AND listings.seller_id = auth.uid()
    )
  );
