import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export function createAnonClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}

export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function createServiceClient(): SupabaseClient {
  if (!config.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for service client");
  }
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export type ListingStatus = "active" | "reserved" | "sold" | "inactive";
export type OrderStatus = "pending" | "confirmed" | "completed" | "cancelled";

export interface Listing {
  id: string;
  title: string;
  price: number;
  seller_id: string;
  status: ListingStatus;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  listing_id: string;
  buyer_id: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}
