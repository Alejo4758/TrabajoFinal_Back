import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../lib/prisma.js";

export const register = async (req, res) => {
  try {
    const {
      email,
      password,
      nombre,
      apellidos,
      tipo_doc,
      nro_doc,
      rol, // Puede ser "CLIENTE", "AT" o "ADMIN"
      fecha_nac // Solo lo recibiremos si rol === "AT"
    } = req.body;

    // 1. Validación de datos obligatorios para la tabla principal (Usuario)
    if (!email || !password || !nombre || !apellidos || !tipo_doc || !nro_doc) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    // 2. Validación específica de la lógica de negocio para Acompañantes Terapéuticos
    if (rol === "AT" && !fecha_nac) {
      return res.status(400).json({ error: "La fecha de nacimiento es obligatoria para el registro de A.T." });
    }

    // 3. Verificar colisiones de email y documento en la misma consulta
    const existingUser = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email },
          { nro_doc }
        ]
      }
    });

    if (existingUser) {
      return res.status(409).json({ error: "El email o el número de documento ya están registrados." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Armar el payload base para Prisma
    const userData = {
      email,
      password: hashedPassword,
      nombre,
      apellidos,
      tipo_doc,
      nro_doc,
      rol: rol || "CLIENTE",
    };

    // 5. Creación anidada: Si es AT, indicamos a Prisma que cree también el perfil vinculado
    if (rol === "AT") {
      userData.perfilAT = {
        create: {
          fecha_nac: new Date(fecha_nac) // Prisma requiere un formato de fecha válido
        }
      };
    }

    // 6. Ejecutar la inserción
    const newUser = await prisma.usuario.create({
      data: userData,
      include: {
        perfilAT: true // Lo devolvemos para confirmar que se creó correctamente
      }
    });

    const { password: _, ...userWithoutPassword } = newUser;

    return res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    // Buscamos en la tabla usuario, trayendo de paso el perfilAT si es que existe
    const user = await prisma.usuario.findUnique({ 
      where: { email },
      include: {
        perfilAT: true 
      }
    });

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    // Inyectamos el ID y el ROL en el token. Esto te va a servir más adelante
    // para los middlewares que restringen rutas según quién hace la petición.
    const token = jwt.sign(
      { userId: user.id, rol: user.rol }, 
      process.env.JWT_SECRET, 
      { expiresIn: "2h" }
    );

    const { password: _, ...userWithoutPassword } = user;

    return res.status(200).json({
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
};

export const logout = (req, res) => {
  return res.status(200).json({ message: "Logout exitoso." });
};