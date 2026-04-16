import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Switcher — Claude chat",
  description: "Chat with Claude and toggle MCP servers on the fly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
