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

export default upload;