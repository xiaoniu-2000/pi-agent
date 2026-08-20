"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "./AppShell";
import styles from "./AuthenticatedApp.module.css";
import type { AccountStatusResponse, WebAccount } from "@/lib/account";

type Phase = "checking" | "login" | "authenticated";
type AuthMode = "login" | "register";

const LOGIN_FAILED_MESSAGE = "登录失败，账号或密码错误";

export function AuthenticatedApp() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [mode, setMode] = useState<AuthMode>("login");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [user, setUser] = useState<WebAccount | null>(null);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showLogin = useCallback((message?: string) => {
    setUser(null);
    setMode("login");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setError(message ?? null);
    setPhase("login");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/account/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as Partial<AccountStatusResponse>;
        setRegistrationEnabled(data.registrationEnabled === true);
        if (!response.ok || !data.authenticated || !data.user) {
          showLogin();
          return;
        }
        setUser(data.user);
        setPhase("authenticated");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        showLogin("暂时无法连接登录服务，请稍后重试");
      });
    return () => controller.abort();
  }, [showLogin]);

  useEffect(() => {
    const handleAuthRequired = () => showLogin("登录状态已失效，请重新登录");
    window.addEventListener("pi-web-auth-required", handleAuthRequired);
    return () => window.removeEventListener("pi-web-auth-required", handleAuthRequired);
  }, [showLogin]);

  const confirmSession = async (): Promise<WebAccount> => {
    const response = await fetch("/api/account/me", { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as Partial<AccountStatusResponse>;
    setRegistrationEnabled(data.registrationEnabled === true);
    if (!response.ok || !data.authenticated || !data.user) {
      throw new Error("登录状态未能保存，请刷新页面后重试");
    }
    return data.user;
  };

  const submitLogin = async () => {
    const response = await fetch("/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId.trim(), password }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error("登录尝试次数过多，请稍后再试");
      if (response.status >= 500) throw new Error("登录服务暂时不可用，请稍后重试");
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    return confirmSession();
  };

  const submitRegistration = async () => {
    if (password !== passwordConfirmation) throw new Error("两次输入的密码不一致");
    if (password.length < 8) throw new Error("密码至少需要 8 个字符");
    const response = await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId.trim(), password }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      if ([400, 403, 409, 429].includes(response.status) && data.error) throw new Error(data.error);
      throw new Error("注册服务暂时不可用，请稍后重试");
    }
    return confirmSession();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const authenticatedUser = mode === "login"
        ? await submitLogin()
        : await submitRegistration();
      setPassword("");
      setPasswordConfirmation("");
      setUser(authenticatedUser);
      setPhase("authenticated");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setError(null);
  };

  const logout = useCallback(async () => {
    try {
      await fetch("/api/account/logout", { method: "POST" });
    } finally {
      showLogin();
    }
  }, [showLogin]);

  if (phase === "checking") {
    return (
      <main className={styles.screen}>
        <div className={styles.checking} role="status">
          <span className={styles.spinner} />
          正在验证登录状态
        </div>
      </main>
    );
  }

  if (phase === "authenticated" && user) {
    return <AppShell webUser={user} onLogout={logout} />;
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const registering = mode === "register";
  return (
    <main className={styles.screen}>
      <section className={styles.authPanel} aria-labelledby="auth-title">
        <div className={styles.brandMark}>
          <Image
            src={`${basePath}/Cepri.png`}
            alt=""
            width={50}
            height={50}
            priority
            unoptimized
          />
        </div>
        <div className={styles.brandName}>新能源气象智能分析 Agent</div>
        <h1 id="auth-title" className={styles.title}>{registering ? "创建你的账号" : "欢迎回来"}</h1>
        <p className={styles.subtitle}>
          {registering ? "注册后将自动进入你的专属工作空间" : "登录后继续使用你的对话与工作文件"}
        </p>

        <form onSubmit={submit} className={styles.form} noValidate>
          <label className={styles.field}>
            <span>账号</span>
            <input
              name="username"
              autoComplete="username"
              autoFocus
              required
              maxLength={64}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="请输入账号"
            />
          </label>
          <label className={styles.field}>
            <span>密码</span>
            <div className={styles.passwordField}>
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={registering ? 8 : undefined}
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={registering ? "至少 8 个字符" : "请输入密码"}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          {registering && (
            <label className={styles.field}>
              <span>确认密码</span>
              <input
                name="password-confirmation"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={256}
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                placeholder="请再次输入密码"
              />
            </label>
          )}

          {error && <div role="alert" className={styles.error}>{error}</div>}

          <button
            type="submit"
            className={styles.primaryButton}
            disabled={submitting || !userId.trim() || !password || (registering && !passwordConfirmation)}
          >
            {submitting && <span className={styles.buttonSpinner} />}
            {submitting ? (registering ? "正在创建账号" : "正在登录") : (registering ? "注册并登录" : "继续")}
          </button>
        </form>

        {registrationEnabled && (
          <p className={styles.switchPrompt}>
            {registering ? "已经有账号？" : "还没有账号？"}
            <button type="button" onClick={() => switchMode(registering ? "login" : "register")}>
              {registering ? "返回登录" : "注册账号"}
            </button>
          </p>
        )}
      </section>
      <div className={styles.footer}>每个账号拥有独立的对话记录与工作空间</div>
    </main>
  );
}
