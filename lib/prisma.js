import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "@prisma/client";

const { Pool } = pg;
const { PrismaClient } = pkg;

const connectionString = `${process.env.DATABASE_URL}`;

// 1. Creamos el Pool de conexiones usando la librería 'pg' nativa
const pool = new Pool({ connectionString });

// 2. Le pasamos el pool creado al adaptador de Prisma
const adapter = new PrismaPg(pool);

// 3. ¡Clave! Le inyectamos el adaptador al cliente de Prisma
const prisma = new PrismaClient({ adapter });

// 4. Exportamos el cliente directo (sin llaves)
export default prisma;