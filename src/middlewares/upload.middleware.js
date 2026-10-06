import multer from "multer";
import path from "path";

// Configuramos dónde y cómo se guardan los archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Los archivos se guardarán físicamente en esta carpeta
    cb(null, "uploads/documentos"); 
  },
  filename: function (req, file, cb) {
    // Le armamos un nombre único para evitar que se sobreescriban
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + extension);
  },
});

// Filtro para aceptar solo PDFs o imágenes
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Formato no válido. Solo se permiten PDF, JPG o PNG."), false);
  }
};

export const upload = multer({ storage, fileFilter });