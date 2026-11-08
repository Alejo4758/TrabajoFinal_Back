import prisma from "../../lib/prisma.js";
import cloudinary from "../config/cloudinary.js";

// Único conjunto de campos que este controlador devuelve: al ser una lista blanca,
// password, verificationToken, documento, etc. no pueden filtrarse por descuido
const userAvatarSelect = {
  id: true,
  name: true,
  lastName: true,
  profilePicture: true,
};

// POST /api/users/:id/avatar  (multipart/form-data, campo "avatar")
export const uploadAvatar = async (req, res) => {
  try {
    // Prevención de IDOR: el usuario a modificar NO se lee de req.params.id.
    // Se usa el id que requireSelfOrAdmin ya comparó contra el JWT (dueño de la cuenta o ADMIN).
    // Si este controlador se montara sin ese middleware, req.targetUserId no existe y se corta acá.
    const targetUserId = req.targetUserId;
    if (!targetUserId) {
      return res
        .status(403)
        .json({ error: "No tenés permisos para realizar esta acción." });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No se envió ninguna imagen. Adjuntala en el campo "avatar".',
      });
    }

    // Se verifica que el usuario exista antes de subir, para no dejar imágenes huérfanas en Cloudinary
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    // Buffer en memoria (Multer) -> Data URI en Base64
    const b64 = req.file.buffer.toString("base64");
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(dataURI, {
        folder: "redat_avatars",
        resource_type: "image",
        // Un solo archivo por usuario: cada subida reemplaza la anterior en vez de acumular fotos viejas.
        // El nombre sale del id validado, nunca de datos enviados por el cliente.
        public_id: `user_${targetUserId}`,
        overwrite: true,
        invalidate: true,
        // El mimetype lo declara el cliente y se puede falsear: Cloudinary revisa el contenido real
        allowed_formats: ["jpg", "png", "webp"],
        transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
      });
    } catch (error) {
      // 400 de Cloudinary = el archivo no es una imagen válida (aunque dijera serlo)
      if (error?.http_code === 400) {
        return res.status(400).json({
          error: "El archivo no es una imagen válida. Solo se permiten JPG, PNG o WEBP.",
        });
      }
      throw error;
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: { profilePicture: uploadResult.secure_url },
      select: userAvatarSelect,
    });

    return res.status(200).json({
      message: "Foto de perfil actualizada con éxito.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Error en uploadAvatar:", error);
    return res.status(500).json({ error: "Error al subir la foto de perfil." });
  }
};
