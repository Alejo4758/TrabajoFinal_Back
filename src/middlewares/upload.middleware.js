import multer from "multer";

// Guardamos el archivo temporalmente en RAM (req.files[i].buffer) para enviarlo a Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const tiposPermitidos = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (tiposPermitidos.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Formato no válido. Solo se permiten PDF, JPG, PNG o WEBP."), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // Máximo 5 MB por documento
});

// ---- Fotos de perfil: mismo almacenamiento en memoria, pero solo imágenes (sin PDF) ----

const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AVATAR_MAX_MB = 5;

const avatarUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (AVATAR_MIME_TYPES.includes(file.mimetype)) return cb(null, true);

    const error = new Error("Formato no válido. Solo se permiten imágenes JPG, PNG o WEBP.");
    error.code = "INVALID_FILE_TYPE";
    cb(error, false);
  },
  limits: { fileSize: AVATAR_MAX_MB * 1024 * 1024, files: 1 },
});

const AVATAR_ERROR_MESSAGES = {
  INVALID_FILE_TYPE: "Formato no válido. Solo se permiten imágenes JPG, PNG o WEBP.",
  LIMIT_FILE_SIZE: `La imagen supera el tamaño máximo de ${AVATAR_MAX_MB} MB.`,
  LIMIT_UNEXPECTED_FILE: 'La imagen debe enviarse en el campo "avatar".',
  LIMIT_FILE_COUNT: "Solo se puede subir una imagen.",
};

// upload.single("avatar") envuelto para que un archivo rechazado responda 400 en JSON
// en vez de caer en el manejador de errores por defecto de Express (500 en HTML)
export const uploadAvatarFile = (req, res, next) => {
  avatarUpload.single("avatar")(req, res, (err) => {
    if (!err) return next();

    return res.status(400).json({
      error: AVATAR_ERROR_MESSAGES[err.code] || "No se pudo procesar el archivo enviado.",
    });
  });
};

export default upload;