import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { Repository } from "@/lib/db/repo";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "admin@example.com" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim();
        const password = credentials.password;

        // Auto-provision demo admin if credentials match admin@example.com / admin
        if (email === "admin@example.com" && password === "admin") {
          let user = await Repository.findUserByEmail("admin@example.com");
          if (!user) {
            user = await Repository.createUser({
              name: "System Admin",
              email: "admin@example.com",
              password: "admin",
              role: "admin",
            });
          }
          const id = user._id ? user._id.toString() : String(user.id);
          return {
            id,
            name: user.name || "System Admin",
            email: user.email,
            role: user.role || "admin",
          };
        }

        const user = await Repository.findUserByEmail(email);
        if (user && user.password === password) {
          const id = user._id ? user._id.toString() : String(user.id);
          return {
            id,
            name: user.name,
            email: user.email,
            role: user.role,
          };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET || "default_secret_for_mvp",
};
