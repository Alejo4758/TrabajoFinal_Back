import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../lib/prisma.js";
import { enviarEmailVerificacion } from "../services/email.service.js";

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
      fecha_nac, // Solo si rol === "AT"
    } = req.body;

    // 1. Validación de datos obligatorios para la tabla principal (Usuario)
    if (!email || !password || !nombre || !apellidos || !tipo_doc || !nro_doc) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    // 2. Validación específica de la lógica de negocio para Acompañantes Terapéuticos
    if (rol === "AT" && !fecha_nac) {
      return res.status(400).json({ error: "La fecha de nacimiento es obligatoria para el registro de A.T." });
    }

    // 3. Verificar colisiones de email y documento
    const existingUser = await prisma.usuario.findFirst({
      where: {
        OR: [{ email }, { nro_doc }],
      },
    });

    if (existingUser) {
      return res.status(409).json({ error: "El email o el número de documento ya están registrados." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Generar token de verificación único y expiración (ej: 24 horas)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenExpira = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 5. Armar el payload base para Prisma
    const userData = {
      email,
      password: hashedPassword,
      nombre,
      apellidos,
      tipo_doc,
      nro_doc,
      rol: rol || "CLIENTE",
      emailVerificado: false,
      verificationToken,
      tokenExpira,
    };

    // 6. Creación anidada: Si es AT, vinculamos perfilAT
    if (rol === "AT") {
      userData.perfilAT = {
        create: {
          fecha_nac: new Date(fecha_nac),
        },
      };
    }

    // 7. Insertar usuario
    const newUser = await prisma.usuario.create({
      data: userData,
      include: {
        perfilAT: true,
      },
    });

    // 8. Enviar el correo con el token
    await enviarEmailVerificacion(newUser.email, verificationToken);

    const { password: _, verificationToken: __, ...userWithoutSensitiveData } = newUser;

    return res.status(201).json({
      message: "Usuario registrado con éxito. Por favor revisa tu correo para confirmar tu cuenta.",
      user: userWithoutSensitiveData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "Token de verificación no proporcionado." });
    }

    // Buscar usuario con ese token y que no esté vencido
    const user = await prisma.usuario.findFirst({
      where: {
        verificationToken: token,
        tokenExpira: {
          gte: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({ error: "El enlace de verificación es inválido o ha expirado." });
    }

    // Marcar como verificado y limpiar tokens
    await prisma.usuario.update({
      where: { id: user.id },
      data: {
        emailVerificado: true,
        verificationToken: null,
        tokenExpira: null,
      },
    });

    return res.status(200).json({ message: "Correo confirmado exitosamente. Ya puedes iniciar sesión." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al verificar el correo." });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    const user = await prisma.usuario.findUnique({
      where: { email },
      include: {
        perfilAT: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    // Validar si confirmó su email antes de otorgar el JWT
    if (!user.emailVerificado) {
      return res.status(403).json({
        error: "Debes confirmar tu correo electrónico antes de iniciar sesión.",
      });
    }

    const token = jwt.sign(
      { userId: user.id, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    const { password: _, verificationToken: __, ...userWithoutPassword } = user;

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