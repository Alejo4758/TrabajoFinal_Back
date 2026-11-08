import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Acceso denegado. Token no proporcionado." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    next(); // Permite que la petición continúe hacia el controlador
  } catch (error) {
    return res.status(403).json({ error: "Token inválido o expirado." });
  }
};

// Se usa después de verifyToken: restringe la ruta a los roles indicados
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res
      .status(403)
      .json({ error: "No tenés permisos para realizar esta acción." });
  }

  next();
};

// Se usa después de verifyToken, en rutas del tipo /:id que modifican datos de UN usuario.
// Prevención de IDOR: el :id de la URL lo elige quien hace la petición, así que no prueba nada.
// La identidad real sale del JWT firmado (req.user.userId); solo se continúa si coincide
// con el :id pedido, o si quien pide es ADMIN.
// Deja el id ya validado en req.targetUserId para que el controlador no vuelva a leer req.params.
export const requireSelfOrAdmin = (req, res, next) => {
  const rawId = String(req.params.id ?? "");

  // Solo dígitos: descarta "5abc", "1e3", "-1", " 5", etc. antes de comparar
  if (!/^\d{1,9}$/.test(rawId) || Number(rawId) === 0) {
    return res.status(400).json({ error: "El ID de usuario no es válido." });
  }

  const targetUserId = Number(rawId);
  const isOwner = req.user?.userId === targetUserId;
  const isAdmin = req.user?.role === "ADMIN";

  if (!isOwner && !isAdmin) {
    return res
      .status(403)
      .json({ error: "No tenés permisos para modificar a otro usuario." });
  }

  req.targetUserId = targetUserId;
  next();
};
