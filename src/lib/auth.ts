// @ts-nocheck
// Auth hook: subscribes to Supabase session, fetches matching profile row,
// exposes signIn (magic link) and signOut.
//
// Signup is disabled at the project level AND shouldCreateUser: false is set
// here, so only users invited via Supabase Auth > Users can sign in.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function fetchProfile(userId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, role, created_at")
        .eq("id", userId)
        .single();
      if (!active) return;
      if (error) {
        console.error("profile fetch error", error);
        setProfile(null);
      } else {
        setProfile(data);
      }
      setLoading(false);
    }

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Subscribe to session changes (sign-in/out, token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Send magic link. shouldCreateUser: false ensures only invited emails succeed.
  async function signIn(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });
    return { error };
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    setProfile(null);
    return { error };
  }

  return {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signIn,
    signOut,
  };
}
