import { Router } from "express";
import {
  getUserConversations,
  getConversationMessages,
  getOrCreateDirectChat,
} from "../controllers/chat.controller.js";

const router = Router();

router.get("/users/:userId/conversations", getUserConversations);
router.get("/conversations/:convId/messages", getConversationMessages);
router.post("/conversations/direct", getOrCreateDirectChat);

export default router;