export type JwtPayload = {
  userId: number;
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN" | "REGISTRAR" | "DEAN";
};
