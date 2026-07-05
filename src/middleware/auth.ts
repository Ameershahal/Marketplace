import { FastifyReply, FastifyRequest } from "fastify";
import { createUserClient } from "../lib/supabase.js";

export interface AuthenticatedRequest extends FastifyRequest {
  accessToken: string;
  userId: string;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing or invalid Authorization header" });
  }

  const accessToken = header.slice("Bearer ".length).trim();
  if (!accessToken) {
    return reply.code(401).send({ error: "Missing access token" });
  }

  const supabase = createUserClient(accessToken);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }

  (request as AuthenticatedRequest).accessToken = accessToken;
  (request as AuthenticatedRequest).userId = data.user.id;
}

export function getAuth(request: FastifyRequest): AuthenticatedRequest {
  return request as AuthenticatedRequest;
}
