import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "pi-web-separated-backend",
    role: "API-only backend; open the frontend on port 30141 (development) or in Tomcat",
    health: "/api/health",
  });
}
