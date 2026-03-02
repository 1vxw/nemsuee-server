import jwt from "jsonwebtoken";
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token)
        return res.status(401).json({ message: "Missing token" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
        req.auth = decoded;
        next();
    }
    catch {
        return res.status(401).json({ message: "Invalid token" });
    }
}
export function requireRole(role) {
    return (req, res, next) => {
        if (req.auth?.role !== role)
            return res.status(403).json({ message: "Forbidden" });
        next();
    };
}
