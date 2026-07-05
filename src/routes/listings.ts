import { FastifyInstance } from "fastify";
import { createAnonClient, createUserClient } from "../lib/supabase.js";
import { authenticate, getAuth } from "../middleware/auth.js";

interface CreateListingBody {
  title: string;
  price: number;
}

interface UpdateListingBody {
  title?: string;
  price?: number;
  status?: "active" | "inactive";
}

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateListingBody }>(
    "/listings",
    { preHandler: authenticate },
    async (request, reply) => {
      const { accessToken, userId } = getAuth(request);
      const { title, price } = request.body ?? {};

      if (!title?.trim()) {
        return reply.code(400).send({ error: "title is required" });
      }
      if (typeof price !== "number" || price < 0) {
        return reply.code(400).send({ error: "price must be a non-negative number" });
      }

      const supabase = createUserClient(accessToken);
      const { data, error } = await supabase
        .from("listings")
        .insert({ title: title.trim(), price, seller_id: userId })
        .select()
        .single();

      if (error) {
        request.log.error(error);
        return reply.code(400).send({ error: error.message });
      }

      return reply.code(201).send(data);
    }
  );

  app.get("/listings", async (_request, reply) => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("listings")
      .select("id, title, price, seller_id, status, created_at")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return reply.send(data);
  });

  app.patch<{ Params: { id: string }; Body: UpdateListingBody }>(
    "/listings/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { accessToken } = getAuth(request);
      const { id } = request.params;
      const updates = request.body ?? {};

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "No fields to update" });
      }

      const allowed: UpdateListingBody = {};
      if (updates.title !== undefined) allowed.title = updates.title;
      if (updates.price !== undefined) allowed.price = updates.price;
      if (updates.status !== undefined) allowed.status = updates.status;

      const supabase = createUserClient(accessToken);
      const { data, error } = await supabase
        .from("listings")
        .update(allowed)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return reply.code(400).send({ error: error.message });
      }
      if (!data) {
        return reply.code(404).send({ error: "Listing not found or not owned by you" });
      }

      return reply.send(data);
    }
  );
}
