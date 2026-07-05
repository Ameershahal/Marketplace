import { FastifyInstance } from "fastify";
import { createAnonClient } from "../lib/supabase.js";

interface SignUpBody {
  email: string;
  password: string;
}

interface SignInBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SignUpBody }>("/auth/signup", async (request, reply) => {
    const { email, password } = request.body ?? {};

    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: "password must be at least 6 characters" });
    }

    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return reply.code(400).send({ error: error.message });
    }

    return reply.code(201).send({
      user: { id: data.user?.id, email: data.user?.email },
      session: data.session
        ? {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
          }
        : null,
      message: data.session
        ? "Account created"
        : "Account created — check email to confirm before signing in",
    });
  });

  app.post<{ Body: SignInBody }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};

    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return reply.code(401).send({ error: error.message });
    }

    return reply.send({
      user: { id: data.user.id, email: data.user.email },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  });
}
