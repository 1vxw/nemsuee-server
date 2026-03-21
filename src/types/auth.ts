export type JwtPayload = {
  userId: number;
  role: "STUDENT" | "INSTRUCTOR" | "GUEST" | "ADMIN" | "REGISTRAR" | "DEAN";
};
