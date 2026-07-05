import { FastifyInstance } from "fastify";
import { createUserClient, OrderStatus } from "../lib/supabase.js";
import { authenticate, getAuth } from "../middleware/auth.js";

interface CreateOrderBody {
  listing_id: string;
}

interface UpdateOrderStatusBody {
  status: OrderStatus;
}

const VALID_ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
];

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateOrderBody }>(
    "/orders",
    { preHandler: authenticate },
    async (request, reply) => {
      const { accessToken, userId } = getAuth(request);
      const { listing_id } = request.body ?? {};

      if (!listing_id) {
        return reply.code(400).send({ error: "listing_id is required" });
      }

      const supabase = createUserClient(accessToken);
      const { data, error } = await supabase
        .from("orders")
        .insert({ listing_id, buyer_id: userId })
        .select()
        .single();

      if (error) {
        const message = error.message.includes("Seller cannot order")
          ? "You cannot order your own listing"
          : error.message.includes("not available")
            ? "This listing is no longer available"
            : error.message;

        return reply.code(400).send({ error: message });
      }

      return reply.code(201).send(data);
    }
  );

  app.get("/orders", { preHandler: authenticate }, async (request, reply) => {
    const { accessToken } = getAuth(request);
    const supabase = createUserClient(accessToken);

    const { data, error } = await supabase
      .from("orders")
      .select("id, listing_id, buyer_id, status, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return reply.send(data);
  });

  app.patch<{ Params: { id: string }; Body: UpdateOrderStatusBody }>(
    "/orders/:id/status",
    { preHandler: authenticate },
    async (request, reply) => {
      const { accessToken } = getAuth(request);
      const { id } = request.params;
      const { status } = request.body ?? {};

      if (!status || !VALID_ORDER_STATUSES.includes(status)) {
        return reply.code(400).send({
          error: `status must be one of: ${VALID_ORDER_STATUSES.join(", ")}`,
        });
      }

      const supabase = createUserClient(accessToken);

      const { error: updateError } = await supabase
        .from("orders")
        .update({ status })
        .eq("id", id);

      if (updateError) {
        return reply.code(400).send({ error: updateError.message });
      }

      // Buyers can read their orders via RLS; sellers can update but not read back.
      const { data } = await supabase
        .from("orders")
        .select("id, listing_id, buyer_id, status, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();

      if (data) {
        return reply.send(data);
      }

      return reply.send({ id, status });
    }
  );
}
