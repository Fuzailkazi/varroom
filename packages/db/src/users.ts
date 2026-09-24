import { prisma } from "./client.ts";

// fetches user profile data for /api/me
export function getUserProfile(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      displayUsername: true,
      name: true,
      email: true,
      emailVerified: true,
      role: true,
      badge: true,
      tacticalIqScore: true,
      createdAt: true,
    },
  });
}

export type UserProfile = NonNullable<Awaited<ReturnType<typeof getUserProfile>>>;
