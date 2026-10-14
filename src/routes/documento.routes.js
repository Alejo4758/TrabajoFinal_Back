import express from "express";
import upload from "../middlewares/upload.middleware.js";
import prisma from "../../lib/prisma.js";

const router = express.Router();

// Cambiamos .single() por .array("documentos", 5) permitiendo hasta 5 archivos a la vez
router.post("/subir", upload.array("documentos", 5), async (req, res) => {
  try {
    // Cuando usamos .array(), Multer guarda los archivos en req.files (en plural)
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No se enviaron archivos." });
    }

    const { profileATId } = req.body;

    if (!profileATId) {
      return res.status(400).json({ error: "Falta el ID del perfil AT." });
    }

    const documentData = req.files.map((archivo) => ({
      title: archivo.originalname,
      fileUrl: archivo.filename,
      profileATId: parseInt(profileATId)
    }));

    const resultado = await prisma.documentAT.createMany({
      data: documentData
    });

    return res.status(201).json({
      message: `Se subieron y registraron ${req.files.length} documentos con éxito.`,
      registrosCreados: resultado.count
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al subir los documentos." });
  }
});

export default router;