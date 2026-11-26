import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";
const TOKEN_KEY = "samay_owner_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = form;
  if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event("owner-logout"));
  }
  if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
  return json;
}

// GET a dashboard endpoint and return { data, error, loading }. Refetches when path or reloadKey changes.
export function useApi(path, reloadKey = 0) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path)
      .then((res) => live && setState({ data: res.data, loading: false }))
      .catch((err) => live && setState({ error: err.message, loading: false }));
    return () => { live = false; };
  }, [path, reloadKey]);
  return state;
}
