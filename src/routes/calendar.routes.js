import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import {
  getMyATCalendar,
  getClientCalendar,
  getATLinkedClients,
  createCalendarActivity,
  requestInterview,
  updateCalendarActivity,
  getNationalHolidays,
} from "../controllers/calendar.controller.js";

const router = Router();

// Todas las rutas del calendario requieren sesión
router.use(verifyToken);

// Rutas estáticas primero, antes de la ruta con parámetro (/:id)
// Agenda privada del A.T. logueado
router.get("/me", requireRole("AT"), getMyATCalendar);

// Turnos del cliente logueado
router.get("/client/me", requireRole("CLIENT"), getClientCalendar);

// Clientes vinculados al A.T., para el selector de pacientes al crear una cita
router.get("/clients", requireRole("AT"), getATLinkedClients);

// Feriados nacionales: cualquier usuario logueado puede verlos en su calendario
router.get("/holidays/:year", getNationalHolidays);

// Solo los clientes pueden pedir una entrevista inicial
router.post("/interview-request", requireRole("CLIENT"), requestInterview);

// Solo los A.T. cargan actividades en su propia agenda
router.post("/", requireRole("AT"), createCalendarActivity);

// A.T. dueño o ADMIN editan; el cliente solo puede cancelar su entrevista (se controla en el controlador)
router.patch("/:id", requireRole("AT", "CLIENT", "ADMIN"), updateCalendarActivity);

export default router;
