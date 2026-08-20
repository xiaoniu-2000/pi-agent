import { Suspense } from "react";
import { AuthenticatedApp } from "@/components/AuthenticatedApp";
import { ApiRuntimeBootstrap } from "@/components/ApiRuntimeBootstrap";

export default function Home() {
  return (
    <ApiRuntimeBootstrap>
      <Suspense>
        <AuthenticatedApp />
      </Suspense>
    </ApiRuntimeBootstrap>
  );
}
