'use client';

import * as React from 'react';
import { detectInstallPlatform, type InstallPlatform } from '@/lib/pwa';

/**
 * Whether the app can be, or already is, installed.
 *
 * Chromium browsers fire `beforeinstallprompt` once, early, and only to pages
 * that are listening at the time, so the listeners are attached when this
 * module first loads (it is imported by the root-layout registrar) rather
 * than when an install button happens to mount.
 *
 * Read through `useSyncExternalStore` with a `null` server snapshot, so the
 * server and the first client render agree and nothing install-related is
 * shown until the browser has actually been asked.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Running from the installed icon (or installed during this visit). */
  installed: boolean;
  /** The browser offered its own install prompt, which `promptInstall` shows. */
  canPrompt: boolean;
}

const listeners = new Set<() => void>();
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisVisit = false;
let snapshot: InstallState | null = null;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // iOS Safari's own flag for home-screen apps.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function readState(): InstallState {
  return { installed: installedThisVisit || isStandalone(), canPrompt: deferredPrompt !== null };
}

function emit() {
  snapshot = readState();
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the prompt for the "Install app" button instead of the browser's
    // own banner, which appears at an arbitrary moment (e.g. mid-sale).
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installedThisVisit = true;
    deferredPrompt = null;
    emit();
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', emit);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): InstallState {
  return (snapshot ??= readState());
}

/** `null` until hydrated: render nothing install-related in that case. */
export function useInstallState(): InstallState | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}

const noSubscription = () => () => {};

/** The browser family, for picking install instructions. `null` on the server. */
export function useInstallPlatform(): InstallPlatform | null {
  return React.useSyncExternalStore(
    noSubscription,
    () => detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints),
    () => null,
  );
}

/** Shows the browser's install prompt. A prompt can only be used once. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  deferredPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  emit();
  return outcome;
}
