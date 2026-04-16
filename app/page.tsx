"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Chat } from "@/components/Chat";
import { loadServers, saveServers } from "@/lib/storage";
import type { McpServer } from "@/lib/types";

const DEFAULT_MODEL = "claude-opus-4-7";
const MODEL_KEY = "mcp-switcher.model.v1";

export default function Page() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setServers(loadServers());
    const m = window.localStorage.getItem(MODEL_KEY);
    if (m) setModel(m);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveServers(servers);
  }, [servers, hydrated]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(MODEL_KEY, model);
  }, [model, hydrated]);

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        servers={servers}
        onChange={setServers}
        model={model}
        onModelChange={setModel}
      />
      <Chat servers={servers} model={model} />
    </div>
  );
}
