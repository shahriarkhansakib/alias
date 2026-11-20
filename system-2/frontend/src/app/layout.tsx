import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/AuthContext";

export const metadata: Metadata = {
  title: "Alias Creative Studio - Multi-Tenant AI Platform",
  description: "Enterprise multi-tenant automated creative generation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
