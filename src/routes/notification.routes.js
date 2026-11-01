import { Router } from "express";
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
} from "../controllers/notification.controller.js";

const router = Router();

router.get("/notifications/user/:userId", getUserNotifications);
router.patch("/notifications/:id/read", markAsRead);
router.patch("/notifications/user/:userId/read-all", markAllAsRead);

export default router;