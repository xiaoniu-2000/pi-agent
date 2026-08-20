export interface WebAccount {
  id: string;
  displayName: string;
  role: "admin" | "user";
}

export interface AccountStatusResponse {
  authenticated: boolean;
  authEnabled: boolean;
  registrationEnabled: boolean;
  user?: WebAccount;
}
