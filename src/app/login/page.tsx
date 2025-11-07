"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { z } from "zod";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormInput } from "@/components/auth/FormInput";
import { AuthButton } from "@/components/auth/AuthButton";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const storeUser = useMutation(api.users.store);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authError && errorRef.current) {
      errorRef.current.focus();
    }
  }, [authError]);

  const redirectTo = searchParams?.get("redirectTo") || "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors },
    setFocus,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setAuthError("");

    try {
      const formData = new FormData();
      formData.append("email", data.email);
      formData.append("password", data.password);

      await signIn("password", formData);
      await storeUser();
      router.push(redirectTo);
    } catch (error) {
      console.error("Login error:", error);
      setAuthError("Invalid email or password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onInvalid = (errors: FieldErrors<LoginFormData>) => {
    const firstField = errors.email ? "email" : errors.password ? "password" : undefined;
    if (firstField) setFocus(firstField);
  };

  return (
    <AuthLayout
      title="Welcome Back"
      subtitle="Sign in to access your dashboard"
      footerText="Don't have an account?"
      footerLink="/sign-up"
      footerLinkText="Sign up now"
    >
      {authError && (
        <div
          className="rounded-m3-md bg-red-100 p-4 mb-6 border border-red-200"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          tabIndex={-1}
          ref={errorRef}
        >
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-600"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">{authError}</h3>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          className="space-y-8"
          aria-busy={isLoading}
          aria-describedby="login-instructions"
        >
          <p id="login-instructions" className="sr-only">
            All fields are required. Enter your email address and password to sign in.
          </p>
          <FormInput
            id="email"
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
            required
            error={errors.email?.message}
            {...register("email")}
          />

          <div>
            <FormInput
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              required
              error={errors.password?.message}
              {...register("password")}
            />
            <div className="text-right mt-3">
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200 transition-colors duration-300 focus-ring rounded"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          <AuthButton type="submit" isLoading={isLoading} fullWidth size="md">
            Sign In
          </AuthButton>
        </form>
      </div>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
  <Suspense
  fallback={
  <div role="status" aria-live="polite" className="flex items-center gap-2">
  <Loader2 className="animate-spin" aria-hidden="true" />
  <span>Loading sign-in form...</span>
  </div>
  }
  >
  <LoginForm />
  </Suspense>
  );
}