import express from "express";
import upload from "../middlewares/upload.middleware.js";
import prisma from "../../lib/prisma.js";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

// Mantenemos .array("documentos", 5) permitiendo hasta 5 archivos a la vez
router.post("/subir", upload.array("documentos", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No se enviaron archivos." });
    }

    const { profileATId } = req.body;

    if (!profileATId) {
      return res.status(400).json({ error: "Falta el ID del perfil AT." });
    }

    const parsedProfileId = parseInt(profileATId, 10);
    if (isNaN(parsedProfileId)) {
      return res.status(400).json({ error: "El ID del perfil AT no es válido." });
    }

    // 1. Subimos todos los archivos en paralelo a la API REST de Cloudinary
    const promesasDeSubida = req.files.map(async (archivo) => {
      // Convertimos el buffer en memoria a Base64 Data URI
      const b64 = Buffer.from(archivo.buffer).toString("base64");
      const dataURI = `data:${archivo.mimetype};base64,${b64}`;

      const uploadResult = await cloudinary.uploader.upload(dataURI, {
        folder: `acompanantes_at/perfil_${parsedProfileId}`, // Organiza carpetas por AT en Cloudinary
        resource_type: "auto", // Soporta tanto imágenes como archivos PDF
      });

      return {
        title: archivo.originalname,
        fileUrl: uploadResult.secure_url, // Guardamos la URL HTTPS de Cloudinary en vez del filename local
        profileATId: parsedProfileId,
      };
    });

    const documentData = await Promise.all(promesasDeSubida);

    // 2. Registramos todos los documentos en PostgreSQL de una sola vez
    const resultado = await prisma.documentAT.createMany({
      data: documentData,
    });

    return res.status(201).json({
      message: `Se subieron a la nube y registraron ${req.files.length} documentos con éxito.`,
      registrosCreados: resultado.count,
      documentos: documentData, // Opcional: devuelve las URLs recién creadas al front
    });

  } catch (error) {
    console.error("Error al subir documentos a Cloudinary:", error);
    return res.status(500).json({ error: "Error al subir los documentos." });
  }
});

// Extra útil: Obtener los documentos de un AT (para verlos en el perfil o panel Admin)
router.get("/perfil/:profileATId", async (req, res) => {
  try {
    const profileATId = parseInt(req.params.profileATId, 10);
    const documentos = await prisma.documentAT.findMany({
      where: { profileATId },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ data: documentos });
  } catch (error) {
    console.error("Error al obtener documentos:", error);
    return res.status(500).json({ error: "Error al obtener los documentos." });
  }
});

export default router;