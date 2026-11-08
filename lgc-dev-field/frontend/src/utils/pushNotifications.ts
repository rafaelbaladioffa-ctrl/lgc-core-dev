import { apiClient } from "../api/client";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr.buffer;
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await apiClient.get<{ vapid_public_key: string }>("/push/vapid-public-key/");
    return res.data.vapid_public_key || null;
  } catch {
    return null;
  }
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await apiClient.post("/push-subscriptions/", {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
}

export async function removeSubscription(sub: PushSubscription): Promise<void> {
  await apiClient.delete("/push-subscriptions/1/", {
    data: { endpoint: sub.endpoint },
  });
  await sub.unsubscribe();
}

export async function registerPushNotifications(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();

    if (!sub) {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }

    await saveSubscription(sub);
    return true;
  } catch {
    return false;
  }
}

export async function initServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // falha silenciosa — não crítico para o funcionamento do app
  }
}
