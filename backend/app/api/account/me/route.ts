import { NextResponse } from "next/server";
import {
  authenticateWebRequest,
  isSelfRegistrationEnabled,
  isWebAuthEnabled,
} from "@/lib/web-auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = authenticateWebRequest(request);
  if (!user) {
    return NextResponse.json(
      {
        authenticated: false,
        authEnabled: isWebAuthEnabled(),
        registrationEnabled: isSelfRegistrationEnabled(),
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      authenticated: true,
      authEnabled: isWebAuthEnabled(),
      registrationEnabled: isSelfRegistrationEnabled(),
      user,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
