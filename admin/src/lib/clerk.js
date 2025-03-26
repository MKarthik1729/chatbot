import { Clerk } from '@clerk/clerk-js';

let clerkInstance = null;
let clerkLoaded = false;

export async function getClerk() {
    if (!clerkInstance) {
        clerkInstance = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
        await clerkInstance.load();
        clerkLoaded = true;
    }
    return clerkInstance;
}

export function isClerkLoaded() {
    return clerkLoaded;
} 