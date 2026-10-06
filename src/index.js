import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import documentoRoutes from "./routes/documento.routes.js"; // <-- Agregamos la importación

const app = express();
app.use(cors());
app.use(express.json());

// Health check para monitorear que el servidor está vivo
app.use("/api/health", (req, res) =>
  res.status(200).json({ message: "Todo correcto master 👍" })
);

// Rutas de autenticación de tu plataforma
app.use("/auth", authRoutes);

// Rutas para manejar los documentos de los A.T.
app.use("/api/documentos", documentoRoutes); // <-- Conectamos la ruta

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de Acompañantes Terapéuticos corriendo en http://localhost:${PORT}`);
});