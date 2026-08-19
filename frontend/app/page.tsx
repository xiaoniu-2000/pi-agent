import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { ApiRuntimeBootstrap } from "@/components/ApiRuntimeBootstrap";

export default function Home() {
  return (
    <ApiRuntimeBootstrap>
      <Suspense>
        <AppShell />
      </Suspense>
    </ApiRuntimeBootstrap>
  );
}
