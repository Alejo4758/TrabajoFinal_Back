import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../lib/prisma.js";
import { enviarEmailVerificacion } from "../services/email.service.js";

// REGISTRO DE CLIENTES NORMALES
export const register = async (req, res) => {
  try {
    const { email, password, name, lastName, documentType, documentNumber, role: roleFromBody, rol } = req.body;

    const normalizedRole = (roleFromBody || rol || "CLIENT").toString().toUpperCase();
    const role = normalizedRole === "CLIENTE" ? "CLIENT" : normalizedRole;

    if (!email || !password || !name || !lastName || !documentType || !documentNumber) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    const emailToSave = email.trim().toLowerCase();

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: emailToSave }, { documentNumber }],
      },
    });

    if (existingUser) {
      return res.status(409).json({ error: "El email o el número de documento ya están registrados." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    
    // CORRECCIÓN APLICADA AQUÍ (ISOString)
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); 

    const newUser = await prisma.user.create({
      data: {
        email: emailToSave,
        password: hashedPassword,
        name,
        lastName,
        documentType,
        documentNumber,
        role,
        emailVerified: false,
        verificationToken,
        tokenExpiresAt,
      },
    });

    await enviarEmailVerificacion(newUser.email, verificationToken);

    const { password: _, verificationToken: __, ...userWithoutSensitiveData } = newUser;

    return res.status(201).json({
      message: "Usuario registrado con éxito. Por favor revisa tu correo para confirmar tu cuenta.",
      user: userWithoutSensitiveData,
    });
  } catch (error) {
    console.error("🔴 ERROR CRÍTICO EN REGISTER (CLIENTE):", error);
    return res.status(500).json({ error: "Error interno del servidor al registrar cliente." });
  }
};

// REGISTRO DE ACOMPAÑANTES TERAPÉUTICOS
export const registerAT = async (req, res) => {
  try {
    const { name, lastName, dateOfBirth, documentType, documentNumber, email, password } = req.body;
    const credencialFile = req.file; 

    if (!email || !password || !name || !lastName || !documentType || !documentNumber || !dateOfBirth) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    if (!credencialFile) {
      return res.status(400).json({ error: "El documento de credenciales es obligatorio." });
    }

    const emailToSave = email.trim().toLowerCase();

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: emailToSave }, { documentNumber }],
      },
    });

    if (existingUser) {
      return res.status(409).json({ error: "El email o el número de documento ya están registrados." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // CORRECCIÓN APLICADA AQUÍ (ISOString)
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const newUser = await prisma.user.create({
      data: {
        email: emailToSave,
        password: hashedPassword,
        name,
        lastName,
        documentType,
        documentNumber,
        role: "AT", 
        emailVerified: false,
        verificationToken,
        tokenExpiresAt,
        profileAT: {
          create: {
            dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`), // Fuerza formato válido
            documents: {
              create: {
                title: credencialFile.originalname,
                fileUrl: credencialFile.filename
              }
            }
          },
        },
      },
      include: {
        profileAT: {
          include: {
            documents: true
          }
        },
      },
    });

    await enviarEmailVerificacion(newUser.email, verificationToken);

    const { password: _, verificationToken: __, ...userWithoutSensitiveData } = newUser;

    return res.status(201).json({
      message: "A.T. registrado con éxito. Por favor revisa tu correo para confirmar tu cuenta.",
      user: userWithoutSensitiveData,
    });
  } catch (error) {
    console.error("🔴 ERROR CRÍTICO EN REGISTER_AT:", error);
    return res.status(500).json({ error: "Error interno del servidor al registrar AT." });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "Token de verificación no proporcionado." });
    }

    const user = await prisma.user.findFirst({
      where: {
        verificationToken: token,
        tokenExpiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({ error: "El enlace de verificación es inválido o ha expirado." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
        tokenExpiresAt: null,
      },
    });

    return res.status(200).json({ message: "Correo confirmado exitosamente. Ya puedes iniciar sesión." });
  } catch (error) {
    console.error("🔴 ERROR EN VERIFY_EMAIL:", error);
    return res.status(500).json({ error: "Error al verificar el correo." });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    const emailToLogin = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: emailToLogin },
      include: {
        profileAT: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Credenciales inválidas." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Debes confirmar tu correo electrónico antes de iniciar sesión.",
      });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    const { password: _, verificationToken: __, ...userWithoutPassword } = user;

    return res.status(200).json({
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error("🔴 ERROR EN LOGIN:", error);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
};

export const logout = (req, res) => {
  return res.status(200).json({ message: "Logout exitoso." });
};