-- KiramoPay Migration 005: Marketplace tables
-- Phase 5: Marketplace & Expansion

-- ============================================================================
-- 1. MARKETPLACE PARTNERS (catalog)
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketplace_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(30) NOT NULL, -- transport, food, supermarket, entertainment, shopping
    logo VARCHAR(100) DEFAULT '',
    color VARCHAR(20) DEFAULT '#000000',
    description TEXT DEFAULT '',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2. USER-PARTNER CONNECTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_partner_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_code VARCHAR(50) NOT NULL REFERENCES marketplace_partners(code),
    connected_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, partner_code)
);

CREATE INDEX IF NOT EXISTS idx_partner_connections_user ON user_partner_connections(user_id);

-- ============================================================================
-- 3. RIDE REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ride_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_code VARCHAR(50) NOT NULL,
    pickup TEXT NOT NULL,
    destination TEXT NOT NULL,
    estimated_price BIGINT NOT NULL,   -- centimos
    estimated_time VARCHAR(30) NOT NULL,
    distance VARCHAR(30) NOT NULL,
    status VARCHAR(20) DEFAULT 'searching', -- searching, confirmed, arriving, in_progress, completed, cancelled
    driver_name VARCHAR(100),
    driver_rating DOUBLE PRECISION,
    driver_car VARCHAR(100),
    driver_plate VARCHAR(20),
    final_price BIGINT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ride_requests_user ON ride_requests(user_id, created_at DESC);

-- ============================================================================
-- 4. FOOD ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS food_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_code VARCHAR(50) NOT NULL,
    restaurant_name VARCHAR(200) NOT NULL,
    subtotal BIGINT NOT NULL,      -- centimos
    delivery_fee BIGINT NOT NULL,  -- centimos
    total BIGINT NOT NULL,         -- centimos
    status VARCHAR(20) DEFAULT 'preparing', -- preparing, ready, on_the_way, delivered, cancelled
    estimated_delivery VARCHAR(30) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_food_orders_user ON food_orders(user_id, created_at DESC);

-- ============================================================================
-- 5. FOOD ORDER ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS food_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price BIGINT NOT NULL  -- centimos
);

CREATE INDEX IF NOT EXISTS idx_food_items_order ON food_order_items(order_id);
