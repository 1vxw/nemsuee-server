import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;

export const prisma = new PrismaClient();
