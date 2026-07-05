import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { listingRoutes } from "./routes/listings.js";
import { orderRoutes } from "./routes/orders.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(listingRoutes);
  await app.register(orderRoutes);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
